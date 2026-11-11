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

/** The scenes scripts/shots.mjs has, and the three this check adds. */
function stepsFor(page, shot) {
  return {
    room: async () => {},
    onboarding: async () => {
      await page.getByRole('dialog', { name: 'Welcome to Beluga' }).waitFor();
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
    },
    diff: async () => {
      await openWs(page);
      await tab(page, 'Diff');
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
    shared: async () => side(page, 'Shared files').click(),
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
        pageFn(`({ calm, reduce, onboarding }) => {
          const selectorOf = ${selectorFn};
          localStorage.setItem('beluga.fork.calm.v1', JSON.stringify({ calm }));
          if (reduce) localStorage.setItem('beluga.prefs.v1', JSON.stringify({ reduceMotion: true }));
          if (!onboarding) localStorage.setItem('beluga.onboarding.v1', JSON.stringify({ version: 'calm-check', at: 0, how: 'finished' }));
          window.__calm = { cls: 0, shifts: [], firstFrame: { calm: false } };
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                const sources = (entry.sources ?? []).slice(0, 4).map((s) => selectorOf(s.node));
                if (!entry.hadRecentInput) window.__calm.cls += entry.value;
                if (window.__calm.shifts.length < 50) window.__calm.shifts.push({ value: entry.value, hadRecentInput: entry.hadRecentInput, sources });
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
        { calm: combo.calm, reduce: combo.reduce, onboarding: scene === 'onboarding' },
      );
      if (combo.reduce) await page.emulateMedia({ reducedMotion: 'reduce' });

      const shots = [];
      const shot = async (moment) => {
        const file = path.join(imgOut, `${scene}-${fileOf(combo.id)}-${moment}.png`);
        await page.screenshot({ path: file, animations: 'allow' });
        shots.push(`img/${path.basename(file)}`);
      };

      await page.goto(url);
      await page.waitForSelector('nav[aria-label="Sidebar"]', { timeout: 20000 }).catch(() => undefined);
      await wait(1200);
      await shot('enter');
      // Arrival animations often end before the scene is ready: ask again here and once at the end.
      const animationsAtEnter = await measureAnimations(page);

      await stepsFor(page, shot)[scene]?.();
      await wait(700);
      await shot('loaded');

      // Hover and select something in the sidebar (a real action, watched for what moves).
      if (scene !== 'onboarding') {
        const row = page.locator('nav[aria-label="Sidebar"] [role="button"]').first();
        if (await row.count().catch(() => 0)) {
          await row.hover();
          await wait(400);
          await shot('hover');
          await row.click();
          await wait(600);
          await shot('select');
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

      combos[combo.id] = { ...shifts, animations, jsMotion, shots };
      await context.close();
    }

    const doc = { scene, at: new Date().toISOString(), git: gitSha(), combos };
    writeFileSync(path.join(out, `${scene}.json`), `${JSON.stringify(doc, null, 2)}\n`);

    console.log(`\n${scene}  (${doc.git})`);
    for (const [id, m] of Object.entries(combos)) {
      console.log(`  ${id.padEnd(15)} cls ${m.cls.toFixed(3)} · animations ${m.animations.length} · jsMotion ${m.jsMotion.elements.length} · data-calm at first frame ${m.firstFrame.calm}`);
    }
    console.log(`  → ${path.relative(repo, path.join(out, `${scene}.json`))}`);
  }
} finally {
  await browser.close();
}

if (errors.length) console.log(`\nERRORS:\n${[...new Set(errors)].slice(0, 20).join('\n')}`);
