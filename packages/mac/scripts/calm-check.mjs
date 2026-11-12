// Measures how calm the Mac app's web view is (docs/calm-ui.md §9).
//   node packages/mac/scripts/calm-check.mjs [scene…]
//     → .context/calm/<scene>.json, and .context/calm/img/<scene>-<combo>-<moment>.png
// Runs each scene in four combinations: calm on/off × motion full/reduce. For each it records the
// layout shifts (CLS and what moved), the animations still playing, the elements JavaScript rewrote
// a style on, and whether data-calm was set by the first frame.
//
// It needs the demo daemon and vite, as scripts/shots.mjs does:
//   npm run dev                    (the repo root: the demo daemon)
//   cd packages/mac && npm run dev (the web view, on 1420 unless BELUGA_URL says otherwise)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../../..');
const out = path.resolve(repo, '.context/calm');
const imgOut = path.join(out, 'img');
const url = process.env.BELUGA_URL ?? process.env.KLAUD_URL ?? 'http://localhost:1420';
const scenes = process.argv.slice(2);

/** BELUGA_THEME=light|dark draws the window in that theme and tags its files (docs/calm/overlay.md §5). */
const theme = process.env.BELUGA_THEME === 'dark' ? 'dark' : process.env.BELUGA_THEME === 'light' ? 'light' : null;
const themeTag = theme ? `${theme}-` : '';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The four combinations, each its own browser context. */
const COMBOS = [
  { id: 'calm-on/full', calm: true, reduce: false },
  { id: 'calm-on/reduce', calm: true, reduce: true },
  { id: 'calm-off/full', calm: false, reduce: false },
  { id: 'calm-off/reduce', calm: false, reduce: true },
];

const fileOf = (combo) => combo.replace('/', '-');

/** Up to four levels of an element: tag, a data attribute, and its first classes (never the hash alone). */
const selectorOf = (el) => {
  if (!el || el.nodeType !== 1) return '';
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < 4) {
    let part = node.tagName.toLowerCase();
    const data = [...node.attributes].find((a) => a.name.startsWith('data-') && a.value && a.value.length < 32);
    if (data) part += `[${data.name}="${data.value.replace(/"/g, '\\"')}"]`;
    const classes = [...node.classList].filter((c) => /^[A-Za-z_][\w-]*$/.test(c)).slice(0, 2);
    if (classes.length) part += `.${classes.join('.')}`;
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
};

const selectorFn = selectorOf.toString();

/**
 * A page function whose own source defines selectorOf. Playwright sends the source text, so the
 * helper travels with it; nothing is eval'd in the page, where the app's CSP would block it.
 */
const pageFn = (source) => new Function(`return (${source});`)();

async function reachable() {
  let viteUp = false;
  let daemonUp = false;
  try {
    viteUp = (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    viteUp = false;
  }
  if (viteUp) {
    try {
      daemonUp = (await fetch(new URL('/__beluga/endpoint', url), { signal: AbortSignal.timeout(3000) })).ok;
    } catch {
      daemonUp = false;
    }
  }
  return { viteUp, daemonUp };
}

const gitSha = () => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const origin = (() => {
  try {
    return new URL(url).origin;
  } catch {
    return 'http://localhost:1420';
  }
})();

const alive = await reachable();
if (!alive.viteUp || !alive.daemonUp) {
  console.error(`Calm check needs the web view and the demo daemon (${url}).`);
  if (!alive.viteUp) console.error('  The web view is not answering. Start it in one terminal:\n    cd packages/mac && npm run dev');
  if (!alive.daemonUp) console.error(`  The daemon is not answering. Start it in another terminal:\n    BELUGA_ALLOW_ORIGINS=${origin} npm run dev`);
  console.error('\nA throwaway home keeps the demo out of your real Beluga data: BELUGA_HOME=/tmp/calm-demo npm run dev (and set it for vite too).');
  console.error('Then: node packages/mac/scripts/calm-check.mjs <scene…>');
  process.exit(1);
}

mkdirSync(imgOut, { recursive: true });

const side = (page, name) => page.locator('nav [role="button"]').filter({ hasText: name }).first();

const openWs = async (page, name = 'add-auth') => {
  if (!(await side(page, name).isVisible().catch(() => false))) await side(page, 'bob-api').click();
  await wait(300);
  await side(page, name).click();
  await wait(700);
};

const tab = async (page, name) => {
  await page.getByRole('tab', { name, exact: true }).click();
  await wait(1200);
};

/** Work's page (Tasks, Plans, Issues…): one sidebar row, then its switch. */
const workPage = async (page, name) => {
  await side(page, 'Work').click();
  await wait(600);
  const choice = page.getByRole('tablist', { name: 'Work' }).getByRole('tab', { name, exact: true });
  if (await choice.count().catch(() => 0)) await choice.first().click();
  await wait(1200);
};

/** The animations still playing on a page, with what they are and where. */
const measureAnimations = (page) =>
  page.evaluate(
    pageFn(`() => {
      const selectorOf = ${selectorFn};
      return document.getAnimations().map((a) => {
        const effect = a.effect;
        const timing = effect && 'getComputedTiming' in effect ? effect.getComputedTiming() : {};
        const named = a.animationName ?? a.transitionProperty;
        const type = typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation ? 'css-animation' : typeof CSSTransition !== 'undefined' && a instanceof CSSTransition ? 'css-transition' : 'js';
        return {
          selector: selectorOf(effect?.target),
          type,
          name: named ?? a.id ?? '',
          duration: typeof timing.duration === 'number' ? timing.duration : null,
          iterations: Number.isFinite(timing.iterations) ? timing.iterations : 'infinite',
          playState: a.playState,
        };
      });
    }`),
  );

/** One entry per animation, whichever moment it was seen at (the longer one wins). */
const mergeAnimations = (...lists) => {
  const byKey = new Map();
  for (const a of lists.flat()) {
    const key = `${a.type}|${a.name}|${a.selector}`;
    const prev = byKey.get(key);
    if (!prev || (a.duration ?? 0) > (prev.duration ?? 0)) byKey.set(key, a);
  }
  return [...byKey.values()];
};

/** The first row in sight in the chat's scroller: its virtual index and where its top is. */
const anchorNow = (page) =>
  page.evaluate(
    pageFn(`() => {
      const first = document.querySelector('[data-index]');
      const scroller = first && first.parentElement && first.parentElement.parentElement;
      if (!scroller) return null;
      const box = scroller.getBoundingClientRect();
      for (const el of document.querySelectorAll('[data-index]')) {
        const r = el.getBoundingClientRect();
        if (r.bottom > box.top + 1 && r.top < box.bottom - 1) return { index: Number(el.getAttribute('data-index')), y: Math.round(r.top) };
      }
      return null;
    }`),
  );

/**
 * Reading further up while new messages come in (docs/calm/hooks.md §2): the row in sight must not
 * move, and the way back down says how many arrived. New rows come from the conversation itself —
 * a long run, then two messages queued while it works — not from sending: a message you send takes
 * you back to the newest on purpose (chat/flight.ts, `beluga:chat-bottom`), which is not this case.
 */
const measureAnchor = async (page) => {
  const box = page.locator('textarea:not(.xterm-helper-textarea)');
  // Whatever the scene sent before this must be over: a message sent while a turn runs is steered
  // or queued, never a turn of its own, so the long run measured here would never start.
  const split = page.getByRole('group', { name: 'Claude is working' });
  for (let t = 0; t < 120000 && (await split.count()); t += 1000) await wait(1000);
  // Enough read-above for the wheel to leave the newest out of sight: the first combo on a fresh
  // home starts with almost no history, a 400px wheel clamps at the top, no scroll event fires and
  // the jump button (what this measures) never comes up. A short turn adds rows until it does.
  const scrollback = () =>
    page.evaluate(() => {
      const first = document.querySelector('[data-index]');
      const el = first?.parentElement?.parentElement;
      return el ? el.scrollHeight - el.clientHeight : 0;
    });
  for (let fills = 0; (await scrollback()) < 900 && fills < 4; fills++) {
    await box.fill('How is auth looking?');
    await box.press('Enter');
    for (let t = 0; t < 120000 && (await split.count()); t += 1000) await wait(1000);
  }
  await box.fill('Take a deep dive into the webhooks');
  await box.press('Enter');
  await split.waitFor({ timeout: 20000 }).catch(() => undefined);
  await wait(1500);
  for (const text of ['And the tests?', 'Keep it small']) {
    await box.fill(text);
    await split.getByRole('button', { name: 'Queue' }).click().catch(() => undefined);
    await wait(300);
  }
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -400);
  await wait(600);
  const before = await anchorNow(page);
  if (!before) return { offsetPx: null, hint: null, newRows: 0 };
  // The run, then each queued message and its answer.
  const tray = page.getByRole('region', { name: 'Queued messages' });
  for (let t = 0; t < 120000; t += 1000) {
    if (!(await tray.count()) && !(await split.count())) break;
    await wait(1000);
  }
  await wait(3000);
  const after = await page.evaluate(
    pageFn(`(index) => {
      const el = document.querySelector('[data-index="' + index + '"]');
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    }`),
    before.index,
  );
  const jump = page.locator('button').filter({ hasText: /^(Latest|\d+ new)$/ });
  const hint = (await jump.count()) ? (await jump.first().innerText()).replace(/\s+/g, ' ').trim() : null;
  const newRows = Number(/^(\d+) new$/.exec(hint ?? '')?.[1] ?? 0);
  return { offsetPx: after === null ? null : after - before.y, hint, newRows };
};

/** The scenes scripts/shots.mjs has, and the three this check adds. A step may return extra fields for the combo's JSON. */
function stepsFor(page, shot) {
  return {
    room: async () => {},
    onboarding: async () => {
      await page.getByRole('dialog', { name: 'Welcome to Beluga' }).waitFor({ timeout: 60000 });
      await wait(3600);
    },
    workspace: async () => openWs(page),
    chatrun: async () => {
      await openWs(page);
      await page.locator('textarea:not(.xterm-helper-textarea)').fill('Add rate limiting to the login endpoint and write tests');
      await page.keyboard.press('Enter');
      await wait(1000);
      await shot('new');
      await wait(4000);
      return { anchor: await measureAnchor(page) };
    },
    diff: async () => {
      await openWs(page);
      // The tab reads "Changes" now (it was "Diff"; History is its second view).
      await tab(page, 'Changes');
    },
    files: async () => {
      await openWs(page);
      await tab(page, 'Files');
      const readme = page.locator('[role="option"]').filter({ hasText: 'README.md' }).first();
      if (await readme.count()) await readme.click();
      await wait(800);
    },
    terminal: async () => {
      await openWs(page);
      await tab(page, 'Terminal');
      await wait(1500);
      await page.keyboard.type('ls -la && git log --oneline -3\n');
      await wait(1500);
    },
    overview: async () => side(page, 'Overview').click(),
    usage: async () => page.getByRole('navigation', { name: 'Sidebar' }).getByRole('button', { name: 'Usage', exact: true }).click(),
    search: async () => {
      await page.getByRole('button', { name: 'Search', exact: true }).first().click();
      await wait(200);
      await page.keyboard.type('auth');
    },
    // The row reads "Files" now (its old name, "Shared files", is the view's kind).
    shared: async () => side(page, 'Files').click(),
    palette: async () => page.keyboard.press('Meta+K'),
    settings: async () => page.keyboard.press('Meta+,'),
    person: async () => page.getByRole('button', { name: 'bob', exact: true }).click(),
    dock: async () => {
      await openWs(page);
      await page.keyboard.press('Meta+J');
      await wait(2500);
      await page.locator('[aria-label="Terminal"] .xterm').click();
      await page.keyboard.type("PROMPT='%1~ %# '; PS1='$ '; clear; git log --oneline -3\n");
      await wait(1200);
      await page.locator('textarea:not(.xterm-helper-textarea)').fill('Run the tests and fix whatever fails');
      await page.keyboard.press('Enter');
      await wait(3500);
    },
    picker: async () => {
      await openWs(page);
      await page.getByRole('button', { name: 'Model and effort' }).click();
      await wait(500);
    },
    plan: async () => workPage(page, 'Plans'),
    tasks: async () => workPage(page, 'Tasks'),
    sentinel: async () => {
      await side(page, 'Sentinel').click();
      await wait(1200);
    },

    // BLG-170 chat/shell scenes
    /** A run's steps while it works: the current row, then the same row opened and closed. */
    chatsteps: async () => {
      // A /btw card from an earlier run stays in the daemon's state: it would change the composer's height here.
      const oldBtw = page.getByRole('button', { name: 'Close the side question' });
      if (await oldBtw.count().catch(() => 0)) {
        await oldBtw.first().click();
        await wait(400);
      }
      await openWs(page);
      const box = page.locator('textarea:not(.xterm-helper-textarea)');
      await box.fill('Add rate limiting to the login endpoint and write tests');
      await box.press('Enter');
      await wait(2200);
      await shot('running');
      const current = page.locator('[data-step][data-current]').first();
      let currentRow = null;
      let workingRow = null;
      if (await current.count().catch(() => 0)) {
        const id = await current.getAttribute('data-step');
        const box = (locator) => locator.boundingBox({ timeout: 3000 }).catch(() => null);
        const before = await box(current);
        const work = page.locator('[data-working="true"]').first();
        const workingBefore = (await work.count().catch(() => 0)) ? await box(work) : null;
        await current.hover({ timeout: 5000 }).catch(() => undefined);
        await wait(400);
        await shot('step-hover');
        const head = current.locator('button').first();
        if (await head.count().catch(() => 0)) {
          await head.click({ timeout: 5000 }).catch(() => undefined);
          await wait(900);
          await shot('step-open');
          await head.click({ timeout: 5000 }).catch(() => undefined);
          await wait(400);
          await shot('step-closed');
        }
        await wait(3000);
        const after = id ? await box(page.locator(`[data-step="${id}"]`)) : null;
        const afterCurrent = id ? await page.locator(`[data-step="${id}"][data-current]`).count().catch(() => 0) : 0;
        const workingAfter = (await work.count().catch(() => 0)) ? await box(work) : null;
        currentRow = {
          id,
          heightBefore: before ? Math.round(before.height) : null,
          heightAfter: after ? Math.round(after.height) : null,
          stillCurrent: afterCurrent > 0,
        };
        workingRow = {
          topBefore: workingBefore ? Math.round(workingBefore.y) : null,
          topAfter: workingAfter ? Math.round(workingAfter.y) : null,
        };
      }
      await wait(3000);
      return { steps: await page.locator('[data-step]').count().catch(() => 0), currentRow, workingRow };
    },
    /** A side question (/btw): the card above the box while it thinks, and once answered. */
    chatbtw: async () => {
      await openWs(page);
      const box = page.locator('textarea:not(.xterm-helper-textarea)');
      await box.fill('/btw what does the login middleware do');
      await box.press('Enter');
      await wait(600);
      await shot('thinking');
      // The thinking tag loops (twinkle) only in this moment; the end-of-scene pass would miss it.
      const thinkingAnimations = await measureAnimations(page);
      await wait(4000);
      await shot('answer');
      const count = await page.locator('[aria-label="Side question"]').count().catch(() => 0);
      // Leave the daemon's state as it was: a card here would sit in every later scene's composer.
      const close = page.getByRole('button', { name: 'Close the side question' });
      if (await close.count().catch(() => 0)) {
        await close.first().click();
        await wait(400);
      }
      return { sideQuestions: count, thinkingAnimations };
    },
    /** The composer's voice: the strip while it gets ready (the model is not on this machine). */
    chatdictation: async () => {
      const oldBtw = page.getByRole('button', { name: 'Close the side question' });
      if (await oldBtw.count().catch(() => 0)) {
        await oldBtw.first().click();
        await wait(400);
      }
      await openWs(page);
      const mic = page.getByRole('button', { name: 'Speak instead of typing' });
      if (await mic.count().catch(() => 0)) {
        await mic.click();
        await wait(700);
        await shot('getting');
        // The busy dots loop only while the strip says it is getting ready.
        const gettingAnimations = await measureAnimations(page);
        await wait(1500);
        return { gettingAnimations };
      }
    },
    /** A message hovered (its quiet actions), then Edit opened and closed. */
    chathover: async () => {
      await openWs(page);
      const own = page.locator('[data-index]').filter({ has: page.locator('button[aria-label="Edit message"]') });
      const last = own.last();
      if (await last.count().catch(() => 0)) {
        await last.hover({ timeout: 5000 }).catch(() => undefined);
        await wait(400);
        await shot('message-hover');
        const edit = page.getByRole('button', { name: 'Edit message' });
        if (await edit.count().catch(() => 0)) {
          await edit.first().click({ timeout: 5000 }).catch(() => undefined);
          await wait(800);
          await shot('edit-open');
          await page.keyboard.press('Escape');
          await wait(300);
          await shot('edit-closed');
        }
      }
    },
    /** The sidebar's signal marks: hover and select a row that needs you. */
    shellsidebar: async () => {
      await wait(600);
      const needs = page.locator('[data-signal-row="needs"], [class*="_needsRow_"]').first();
      if (await needs.count().catch(() => 0)) {
        await needs.hover({ timeout: 5000 }).catch(() => undefined);
        await wait(400);
        await shot('needs-hover');
        await needs.click({ timeout: 5000 }).catch(() => undefined);
        await wait(900);
        await shot('needs-select');
      }
    },
    /** The right panel: open on Changes, closed from the toolbar, opened again. */
    shellpanel: async () => {
      await openWs(page);
      await tab(page, 'Changes');
      await wait(500);
      await shot('panel-open');
      const hide = page.getByRole('button', { name: 'Hide the panel' });
      if (await hide.count().catch(() => 0)) {
        await hide.click();
        await wait(500);
        await shot('panel-closed');
      }
      const show = page.getByRole('button', { name: /^Show the panel/ });
      if (await show.count().catch(() => 0)) {
        await show.click();
        await wait(500);
        await shot('panel-reopened');
      }
    },
    /** The shell's two folds: the sidebar and the right panel, each hidden and back (their buttons;
     *  ⌘B did not reach the window from the web view). */
    shellcollapse: async () => {
      await openWs(page);
      const hideSide = page.getByRole('button', { name: 'Hide sidebar' });
      if (await hideSide.count().catch(() => 0)) {
        await hideSide.first().click();
        await wait(500);
        await shot('sidebar-hidden');
      }
      const showSide = page.getByRole('button', { name: 'Show sidebar' });
      if (await showSide.count().catch(() => 0)) {
        await showSide.first().click();
        await wait(500);
        await shot('sidebar-shown');
      }
      const hidePanel = page.getByRole('button', { name: 'Hide the panel' });
      if (await hidePanel.count().catch(() => 0)) {
        await hidePanel.first().click();
        await wait(500);
        await shot('panel-hidden');
      }
      const showPanel = page.getByRole('button', { name: /^Show the panel/ });
      if (await showPanel.count().catch(() => 0)) {
        await showPanel.first().click();
        await wait(500);
        await shot('panel-shown');
      }
    },
    /** The notification centre under the bell, opened and closed. */
    shellnotifications: async () => {
      await openWs(page);
      const bell = page.getByRole('button', { name: /^Notifications/ });
      if (await bell.count().catch(() => 0)) {
        await bell.click();
        await wait(600);
        await shot('open');
        const waiting = page.getByRole('tab', { name: /^Needs you/ });
        if (await waiting.count().catch(() => 0)) {
          await waiting.first().click();
          await wait(500);
          await shot('filter');
        }
        await page.keyboard.press('Escape');
        await wait(400);
        await shot('closed');
      }
    },

    // BLG-171 work/data scenes
    /** The plan canvas (React Flow): nodes, edges and the transitions they keep. */
    plancanvas: async () => {
      await side(page, 'Card checkout for launch').click();
      await wait(2500);
      await shot('canvas');
      return {
        flow: await page.evaluate(
          pageFn(`() => {
            const node = document.querySelector('.react-flow__node');
            const edge = document.querySelector('.react-flow__edge-path');
            const cs = node ? getComputedStyle(node) : null;
            return {
              nodes: document.querySelectorAll('.react-flow__node').length,
              edges: document.querySelectorAll('.react-flow__edge').length,
              nodeDuration: cs ? cs.transitionDuration : null,
              nodeTiming: cs ? cs.transitionTimingFunction : null,
              edgeDuration: edge ? getComputedStyle(edge).transitionDuration : null,
            };
          }`),
        ),
      };
    },
    /** A task's page, opened from its card on the board. */
    taskdetail: async () => {
      await workPage(page, 'Tasks');
      const card = page.locator('[role="list"][aria-label="Board"] [role="button"][aria-label]').first();
      if (await card.count().catch(() => 0)) {
        await card.click({ timeout: 8000 }).catch(() => undefined);
        await wait(1800);
        await shot('task');
      }
    },
    /** A task created on the board: where its card lands and what the column does to the others. */
    tasknew: async () => {
      await workPage(page, 'Tasks');
      const places = () =>
        page.evaluate(() =>
          [...document.querySelectorAll('[role="list"][aria-label="Board"] [role="button"][aria-label]')].map((el) => ({
            label: el.getAttribute('aria-label'),
            y: Math.round(el.getBoundingClientRect().top),
            h: Math.round(el.getBoundingClientRect().height),
          })),
        );
      const before = await places();
      const newTask = page.getByRole('button', { name: 'New Task', exact: true });
      if (await newTask.count().catch(() => 0)) {
        await newTask.first().click();
        await wait(700);
        // The sheet starts asking the agent; write the title here instead (deterministic).
        const myself = page.getByRole('button', { name: 'Write title and goal myself' });
        if (await myself.count().catch(() => 0)) {
          await myself.first().click();
          await wait(300);
        }
        const title = page.locator('#task-title');
        if (await title.count().catch(() => 0)) {
          await title.fill('Board insert probe');
          await wait(300);
        }
        const create = page.getByRole('button', { name: /^Create Task/ });
        if (await create.count().catch(() => 0)) {
          await create.first().click();
          await wait(2000);
        }
      }
      if (await page.getByRole('dialog').count().catch(() => 0)) await page.keyboard.press('Escape');
      await wait(1200);
      const after = await places();
      await shot('after-create');
      return { before, after };
    },
    /** GitHub issues, from Work. */
    issues: async () => {
      await workPage(page, 'Issues');
      await shot('issues');
    },
    /** Sentinel's dashboard: tiles and charts, and whether the numbers sit in fixed-width digits. */
    sentineldash: async () => {
      await page.getByRole('button', { name: 'Settings and menus' }).click();
      await wait(300);
      await page.getByRole('menuitem', { name: 'Go' }).hover();
      await wait(300);
      await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
      await wait(2000);
      await shot('dashboard');
      return {
        numbers: await page.evaluate(
          pageFn(`() => {
            const out = [];
            for (const el of document.querySelectorAll('span, div, b, strong')) {
              const t = (el.textContent ?? '').trim();
              if (!/^[-+$€£]?[\\d,.]+[%KMB]?$/.test(t) || el.children.length) continue;
              const r = el.getBoundingClientRect();
              if (!r.width) continue;
              const cs = getComputedStyle(el);
              out.push({ text: t, width: Math.round(r.width), numeric: cs.fontVariantNumeric });
              if (out.length >= 20) break;
            }
            return out;
          }`),
        ),
      };
    },
    /** A project's home page: its numbers, plans, worktrees and tasks. */
    projecthome: async () => {
      await side(page, 'bob-api').click();
      await wait(2000);
      await shot('project');
    },

    // BLG-172 rest scenes
    /** The room's group chat (network page), with its pending requests. */
    network: async () => {
      await side(page, 'Group chat').click();
      await wait(1500);
      await shot('group');
      const decision = page.getByRole('button', { name: 'Let in' });
      if (await decision.count().catch(() => 0)) {
        await decision.first().hover({ timeout: 5000 }).catch(() => undefined);
        await wait(300);
        await shot('decision-hover');
      }
      return { pending: await page.locator('[role="button"]').filter({ hasText: /wants to join|trust/i }).count().catch(() => 0) };
    },
    /** A call in the room: the in-call strip and its controls (the ring itself is for incoming calls). */
    call: async () => {
      await side(page, 'Group chat').click();
      await wait(1200);
      const start = page.getByRole('button', { name: /^Call the Room/ });
      if (await start.count().catch(() => 0)) {
        await start.first().click();
        await wait(2500);
        await shot('in-call');
        const inCall = await measureAnimations(page);
        const leave = page.getByRole('button', { name: 'Leave Call' });
        const left = await leave.count().catch(() => 0);
        if (left) {
          await leave.first().click({ timeout: 5000 }).catch(() => undefined);
          await wait(800);
        }
        return { inCall, leaveVisible: left };
      }
    },
    /** A destructive dialog: removing a friend from the room, its copy and its buttons. */
    confirmremove: async () => {
      await side(page, 'Group chat').click();
      await wait(900);
      const bob = page.getByRole('button', { name: 'bob', exact: true });
      if (await bob.count().catch(() => 0)) {
        await bob.first().click({ timeout: 5000 }).catch(() => undefined);
        await wait(700);
        const remove = page.getByRole('button', { name: /Remove from Room/ });
        if (await remove.count().catch(() => 0)) {
          await remove.first().click({ timeout: 5000 }).catch(() => undefined);
          await wait(800);
          await shot('remove');
          const text = (await page.getByRole('dialog').first().innerText().catch(() => '')).slice(0, 700);
          // Never confirm it: back out with Escape.
          await page.keyboard.press('Escape');
          await wait(300);
          await page.keyboard.press('Escape');
          await wait(300);
          return { dialogText: text };
        }
      }
    },
  };
}

const browser = await chromium.launch();
const errors = [];

try {
  for (const scene of scenes.length ? scenes : ['room']) {
    const combos = {};
    for (const combo of COMBOS) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
      const page = await context.newPage();
      page.on('console', (m) => m.type() === 'error' && errors.push(`${scene}: ${m.text()}`));
      page.on('pageerror', (e) => errors.push(`${scene}: ${String(e)}`));

      // Before the app draws: the two switches, past the welcome, layout shifts from the first frame,
      // and whether data-calm was on before the first frame.
      await page.addInitScript(
        pageFn(`({ calm, reduce, onboarding, theme }) => {
          const selectorOf = ${selectorFn};
          localStorage.setItem('beluga.fork.calm.v1', JSON.stringify({ calm }));
          const prefs = {};
          if (reduce) prefs.reduceMotion = true;
          if (theme) prefs.appearance = theme;
          if (reduce || theme) localStorage.setItem('beluga.prefs.v1', JSON.stringify(prefs));
          if (!onboarding) localStorage.setItem('beluga.onboarding.v1', JSON.stringify({ version: 'calm-check', at: 0, how: 'finished' }));
          window.__calm = { cls: 0, shifts: [], firstFrame: { calm: false } };
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                const sources = (entry.sources ?? []).slice(0, 4).map((s) => selectorOf(s.node));
                if (!entry.hadRecentInput) window.__calm.cls += entry.value;
                if (window.__calm.shifts.length < 50) window.__calm.shifts.push({ value: entry.value, hadRecentInput: entry.hadRecentInput, t: Math.round(entry.startTime), sources });
              }
            }).observe({ type: 'layout-shift', buffered: true });
          } catch {
            // A browser without layout-shift entries: the other columns still say something.
          }
          // The first frame after the app's own modules have run. The bare document's first rAF comes
          // before them, so it can never see data-calm; DOMContentLoaded + one frame is the first
          // frame the app itself could paint.
          document.addEventListener('DOMContentLoaded', () => {
            requestAnimationFrame(() => {
              window.__calm.firstFrame.calm = document.documentElement.dataset.calm === '1';
            });
          });
        }`),
        { calm: combo.calm, reduce: combo.reduce, onboarding: scene === 'onboarding', theme },
      );
      if (combo.reduce) await page.emulateMedia({ reducedMotion: 'reduce' });

      const shots = [];
      const shot = async (moment) => {
        const file = path.join(imgOut, `${scene}-${themeTag}${fileOf(combo.id)}-${moment}.png`);
        await page.screenshot({ path: file, animations: 'allow' });
        shots.push(`img/${path.basename(file)}`);
      };

      // `?welcome` forces the onboarding: the reduce combos have preferences, which otherwise mean
      // "used Beluga before onboarding existed" and skip it (onboarding/onboarding-model.ts).
      await page.goto(scene === 'onboarding' ? `${url}${url.includes('?') ? '&' : '?'}welcome` : url);
      await page.waitForSelector('nav[aria-label="Sidebar"]', { timeout: 20000 }).catch(() => undefined);
      await wait(1200);
      await shot('enter');
      // Arrival animations often end before the scene is ready: ask again here and once at the end.
      const animationsAtEnter = await measureAnimations(page);

      const extra = (await stepsFor(page, shot)[scene]?.()) ?? {};
      await wait(700);
      await shot('loaded');

      // Hover and select something in the sidebar (a real action, watched for what moves). A dialog
      // or popover can be over the sidebar (palette, settings): its overlay intercepts the pointer,
      // and the scene's own shots already cover that moment.
      if (scene !== 'onboarding') {
        const row = page.locator('nav[aria-label="Sidebar"] [role="button"]').first();
        if (await row.count().catch(() => 0)) {
          try {
            await row.hover({ timeout: 3000 });
            await wait(400);
            await shot('hover');
            await row.click({ timeout: 3000 });
            await wait(600);
            await shot('select');
          } catch {
            // Covered by the scene itself (an open dialog's overlay, a pointer outside the window).
          }
        }
      }

      const shifts = await page.evaluate(() => {
        const c = window.__calm ?? { cls: 0, shifts: [], firstFrame: { calm: false } };
        return { cls: Number(c.cls.toFixed(4)), shifts: c.shifts, firstFrame: c.firstFrame };
      });

      const animations = mergeAnimations(animationsAtEnter, await measureAnimations(page));

      // What JavaScript rewrote a style on in two seconds: live-motion's clock, mostly.
      const jsMotion = await page.evaluate(
        pageFn(`async () => {
          const selectorOf = ${selectorFn};
          const counts = new Map();
          const observer = new MutationObserver((list) => {
            for (const m of list) {
              if (m.type === 'attributes' && m.attributeName === 'style' && m.target instanceof Element) counts.set(m.target, (counts.get(m.target) ?? 0) + 1);
            }
          });
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'], subtree: true });
          await new Promise((r) => setTimeout(r, 2000));
          observer.disconnect();
          return {
            seconds: 2,
            elements: [...counts]
              .map(([el, writes]) => ({ selector: selectorOf(el), writes }))
              .sort((a, b) => b.writes - a.writes)
              .slice(0, 50),
          };
        }`),
      );

      combos[combo.id] = { ...shifts, animations, jsMotion, ...extra, shots };
      await context.close();
    }

    const doc = { scene, at: new Date().toISOString(), git: gitSha(), combos };
    writeFileSync(path.join(out, `${themeTag}${scene}.json`), `${JSON.stringify(doc, null, 2)}\n`);

    console.log(`\n${scene}  (${doc.git})`);
    for (const [id, m] of Object.entries(combos)) {
      console.log(`  ${id.padEnd(15)} cls ${m.cls.toFixed(3)} · animations ${m.animations.length} · jsMotion ${m.jsMotion.elements.length} · data-calm at first frame ${m.firstFrame.calm}`);
      if (m.anchor) console.log(`  ${''.padEnd(15)} anchor offset ${m.anchor.offsetPx}px · hint ${JSON.stringify(m.anchor.hint)} · ${m.anchor.newRows} new rows`);
    }
    console.log(`  → ${path.relative(repo, path.join(out, `${themeTag}${scene}.json`))}`);
  }
} finally {
  await browser.close();
}

if (errors.length) console.log(`\nERRORS:\n${[...new Set(errors)].slice(0, 20).join('\n')}`);
