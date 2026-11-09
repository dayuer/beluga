/**
 * The engine's own words (src/ui, src/shared) as the Mac shows them, in the language shown. The
 * engine keeps its English for the phone and the terminal, so this reads what it made (a state's
 * label, a button's hint, a menu's options by id) and says the same in the window's language. In
 * English everything comes back exactly as the engine made it; anything not recognised stays
 * English too, so a new engine word shows (in English) rather than vanishing.
 */
import { type Locale, type Vars, makeT } from '../../../../src/shared/i18n.js';
import type { AppState } from '@beluga/core/store.js';
import type { PullRequest } from '@beluga/core/work-store.js';
import type { MenuKind, MenuOption, MenuSpec } from '@beluga/ui/menus.js';
import { menuSpec } from '@beluga/ui/menus.js';
import { stateOf, type WorkspaceButton, type WorkspaceState } from '@beluga/ui/workspace-models.js';
import type { CardWindow } from '@beluga/ui/usage-cards.js';
import { describePr } from '@beluga/shared/format.js';
import { notOnPrLabel } from '@beluga/core/branch-state.js';
import type { Workspace } from '@beluga/workspaces/types.js';
import { x_engine as enEngine } from '../i18n/en/x-engine.js';
import { x_engine as zhEngine } from '../i18n/zh-CN/x-engine.js';
import { common as enCommon } from '../i18n/en/common.js';
import { common as zhCommon } from '../i18n/zh-CN/common.js';
import { currentLocale } from '../i18n/index.js';
import { fileManager, openFolderLabel } from './os-words.js';

const EN = { ...enCommon, ...enEngine } as const;
type WordKey = keyof typeof EN & string;
const wordsOf = makeT(EN, { 'zh-CN': { ...zhCommon, ...zhEngine } });

/** The words for one language (`lang` defaults to the one shown now). */
const say = (lang: Locale) => wordsOf(lang) as (key: WordKey, vars?: Vars) => string;

const num = (s: string | undefined): number => Number(s ?? 0);

// ---------------------------------------------------------------- time

/** "just now", "3m ago" (the engine's `ago`) in the language shown. */
export function localAgo(text: string, lang: Locale = currentLocale()): string {
  if (lang === 'en') return text;
  const w = say(lang);
  if (text === 'just now') return w('engine.ago.justNow');
  const m = /^(\d+)([mhd]) ago$/.exec(text);
  if (!m) return text;
  return w(m[2] === 'm' ? 'engine.ago.minutes' : m[2] === 'h' ? 'engine.ago.hours' : 'engine.ago.days', { n: num(m[1]) });
}

/** "42s", "1m05s" (formatDuration) in the language shown. */
export function localDuration(text: string, lang: Locale = currentLocale()): string {
  if (lang === 'en') return text;
  const w = say(lang);
  const s = /^(\d+)s$/.exec(text);
  if (s) return w('engine.duration.seconds', { s: num(s[1]) });
  const ms = /^(\d+)m(\d\d)s$/.exec(text);
  return ms ? w('engine.duration.minutes', { m: num(ms[1]), s: ms[2]! }) : text;
}

// ---------------------------------------------------------------- a workspace's state

const UNCOMMITTED = /^(\d+) uncommitted changes?$/;

/** The engine's state line (stateOf's label) in the language shown. */
export function localStateLabel(label: string, lang: Locale = currentLocale()): string {
  if (lang === 'en') return label;
  const w = say(lang);
  const exact: Record<string, WordKey> = {
    'Merge conflict': 'engine.state.conflict',
    'Needs your approval': 'engine.state.approval',
    Archived: 'engine.state.archived',
    'New chat': 'engine.state.newChat',
    'Merged on GitHub': 'engine.state.mergedOnGitHub',
    'Up to date': 'engine.state.upToDate',
    Merged: 'engine.state.merged',
    'Main folder': 'engine.state.mainFolder',
  };
  const key = exact[label];
  if (key) return w(key);
  const working = /^Agent working(?: (\d+s|\d+m\d\ds))?( · (\d+) sub-agents? running| · background task)?$/.exec(label);
  if (working) {
    const head = working[1] ? w('engine.state.workingFor', { time: localDuration(working[1], lang) }) : w('engine.state.working');
    const extra = working[3] ? w('engine.state.subagents', { n: num(working[3]) }) : working[2] ? w('engine.state.background') : '';
    return head + extra;
  }
  const chat = /^Chat · (.+)$/.exec(label);
  if (chat) return w('engine.state.chatAgo', { ago: localAgo(chat[1]!, lang) });
  const changed = UNCOMMITTED.exec(label);
  if (changed) return w('engine.state.uncommitted', { n: num(changed[1]) });
  const ready = /^Ready to merge · (\d+) commits?$/.exec(label);
  if (ready) return w('engine.state.readyToMerge', { n: num(ready[1]) });
  const gap = /^(\d+) commits? not on PR #(\d+)(?: · (\d+) uncommitted changes?)?$/.exec(label);
  if (gap) return w('engine.state.notOnPr', { count: num(gap[1]), number: num(gap[2]) }) + (gap[3] ? w('engine.state.withUncommitted', { n: num(gap[3]) }) : '');
  return label;
}

/** stateOf, its label in the language shown (everything else as it is). */
export function localStateOf(state: AppState, ws: Workspace, frame: number, now = Date.now(), lang: Locale = currentLocale()): WorkspaceState {
  const st = stateOf(state, ws, frame, now);
  if (lang === 'en') return st;
  return { ...st, label: localStateLabel(st.label, lang) };
}

/** "3 commits not on PR #398" (notOnPrLabel) in the language shown. */
export function localNotOnPr(gap: { readonly count: number; readonly number: number }, lang: Locale = currentLocale()): string {
  return lang === 'en' ? notOnPrLabel(gap) : say(lang)('engine.state.notOnPr', { count: gap.count, number: gap.number });
}

/** "PR #12 · checks passing · approved" (describePr) in the language shown. */
export function localDescribePr(pr: PullRequest, lang: Locale = currentLocale()): string {
  if (lang === 'en') return describePr(pr);
  const w = say(lang);
  if (pr.state === 'MERGED') return w('engine.pr.merged', { number: pr.number });
  if (pr.state === 'CLOSED') return w('engine.pr.closed', { number: pr.number });
  const checks = pr.checks === 'passing' ? w('engine.pr.checks.passing') : pr.checks === 'failing' ? w('engine.pr.checks.failing') : pr.checks === 'pending' ? w('engine.pr.checks.pending') : '';
  const review = pr.review === 'APPROVED' ? w('engine.pr.approved') : pr.review === 'CHANGES_REQUESTED' ? w('engine.pr.changesRequested') : '';
  return `PR #${pr.number}${pr.draft ? w('engine.pr.draft') : ''}${checks}${review}`;
}

// ---------------------------------------------------------------- the workspace's buttons

const BUTTON_LABELS: Readonly<Record<string, WordKey>> = {
  Run: 'engine.button.run',
  Review: 'engine.button.review',
  Commit: 'engine.button.commit',
  Merge: 'engine.button.merge',
  'Solve conflict': 'engine.button.solveConflict',
  'Merge Locally': 'engine.button.mergeLocally',
  'Hand off': 'engine.button.handOff',
  Compact: 'engine.button.compact',
  Fork: 'engine.button.fork',
  Archive: 'engine.button.archive',
  Restore: 'engine.button.restore',
  Delete: 'engine.button.delete',
  Share: 'engine.button.share',
};

const BUTTON_HINTS: Readonly<Record<string, WordKey>> = {
  'Bring this workspace back': 'engine.hint.restore',
  'Delete permanently': 'engine.hint.delete',
  'Ask your agent to check everything: bugs, security, tests and quality': 'engine.hint.review',
  'Nothing to commit': 'engine.hint.nothingToCommit',
  'Your agent pushes and opens a pull request with a short description': 'engine.hint.prCreate',
  'Nothing to put in a pull request yet': 'engine.hint.prNothing',
  'Ask your agent to resolve the merge conflict and finish the merge': 'engine.hint.solveConflict',
  'Commit your changes first': 'engine.hint.commitFirst',
  'Nothing to merge yet': 'engine.hint.nothingToMerge',
  "A friend's agent continues this on their computer": 'engine.hint.handOff',
  'Add a friend first; then their agent can take this over': 'engine.hint.handOffAddFriend',
  'Turn on the Beluga network to hand this to a friend, or invite someone to your room': 'engine.hint.handOffNetwork',
  'Shrink the conversation so your agent has room to keep going': 'engine.hint.compact',
  'Copy this workspace and its conversation into a new worktree': 'engine.hint.fork',
  'Put it away; keeps the branch and conversation': 'engine.hint.archive',
  'Invite a friend to just this worktree: they see the chat and files and can ask your agent here': 'engine.hint.share',
};

/** A button's label (workspaceButtons) in the language shown; "PR #12 ✓" and the file manager's name stay as they are. */
export function localButtonLabel(label: string, lang: Locale = currentLocale()): string {
  if (lang === 'en') return label;
  const w = say(lang);
  const key = BUTTON_LABELS[label];
  if (key) return w(key);
  const shared = /^Shared · (\d+)$/.exec(label);
  if (shared) return w('engine.button.shared', { n: num(shared[1]) });
  if (label === 'Finder' || label === 'File Explorer' || label === 'Files') return fileManager();
  return label;
}

/** A button's hint (workspaceButtons) in the language shown. A runtime's own reason (Compact, Fork) stays English. */
export function localButtonHint(hint: string, lang: Locale = currentLocale()): string {
  if (lang === 'en') return hint;
  const w = say(lang);
  const key = BUTTON_HINTS[hint];
  if (key) return w(key);
  let m: RegExpExecArray | null;
  if ((m = /^Start (.+) in the Terminal tab$/.exec(hint))) return w('engine.hint.run', { command: m[1]! });
  if ((m = /^Commit (\d+) changed file\(s\)$/.exec(hint))) return w('engine.hint.commit', { n: num(m[1]) });
  if ((m = /^Merge (\d+) commit\(s\) into the main folder$/.exec(hint))) return w('engine.hint.mergeIntoMain', { n: num(m[1]) });
  if ((m = /^Merge (\d+) commit\(s\) into (.+) main folder$/.exec(hint))) return w('engine.hint.mergeInto', { n: num(m[1]), name: m[2]! });
  if ((m = /^Open this folder in (Finder|File Explorer|Files)$/.exec(hint))) return w('engine.hint.finder', { app: fileManager() });
  if ((m = /^(\d+) (?:person is|people are) in this workspace: invite or remove people$/.exec(hint))) return w('engine.hint.sharedWith', { n: num(m[1]) });
  if ((m = /^(PR #\d+.*): open it, fix checks, or update it$/.exec(hint))) return w('engine.hint.prOpen', { pr: localPrWords(m[1]!, lang) });
  return hint;
}

/** describePr's words when only its text is at hand. */
function localPrWords(text: string, lang: Locale): string {
  const w = say(lang);
  const m = /^PR #(\d+)( merged| closed)?( \(draft\))?( · checks (passing|failing|pending))?( · approved| · changes requested)?$/.exec(text);
  if (!m) return text;
  const n = num(m[1]);
  if (m[2] === ' merged') return w('engine.pr.merged', { number: n });
  if (m[2] === ' closed') return w('engine.pr.closed', { number: n });
  const checks = m[5] ? w(`engine.pr.checks.${m[5]}` as WordKey) : '';
  const review = m[6] === ' approved' ? w('engine.pr.approved') : m[6] ? w('engine.pr.changesRequested') : '';
  return `PR #${n}${m[3] ? w('engine.pr.draft') : ''}${checks}${review}`;
}

/** A shared button, its label and hint in the language shown. */
export function localButton<B extends Pick<WorkspaceButton, 'label' | 'hint'>>(b: B, lang: Locale = currentLocale()): B {
  if (lang === 'en') return b;
  return { ...b, label: localButtonLabel(b.label, lang), hint: localButtonHint(b.hint, lang) };
}

// ---------------------------------------------------------------- menus

type Option = MenuOption;

const closeWords = (o: Option, w: ReturnType<typeof say>): Option => {
  if (o.label === 'Close') return { ...o, label: w('engine.menu.close') };
  if (o.label === 'Cancel') return { ...o, label: w('engine.menu.cancel') };
  if (o.label === 'Done') return { ...o, label: w('engine.menu.done') };
  if (o.label === '‹ Back') return { ...o, label: w('engine.menu.back') };
  return o;
};

function projectWords(spec: MenuSpec, state: AppState, id: string, w: ReturnType<typeof say>): MenuSpec {
  const p = state.projects.find((x) => x.id === id);
  const group = p ? state.projectGroups.find((g) => g.projects.includes(p.root)) : undefined;
  const intro = spec.intro.map((line, i) => (i === 1 && line === 'Not in a group' ? w('engine.project.noGroup') : i === 1 && group && line === `In group: ${group.name}` ? w('engine.project.inGroup', { name: group.name }) : line));
  const options = spec.options.map((o): Option => {
    switch (o.id) {
      case 'p-worktree':
        return { ...o, label: w('engine.project.worktree'), hint: w('engine.project.worktreeHint') };
      case 'p-chat':
        return { ...o, label: w('engine.project.chat'), hint: w('engine.project.chatHint') };
      case 'p-invite':
        return { ...o, label: w('engine.project.invite'), hint: w('engine.project.inviteHint') };
      case 'p-scripts': {
        const setup = o.hint?.startsWith('setup: ') ? o.hint.slice('setup: '.length) : undefined;
        return { ...o, label: w('engine.project.scripts'), hint: setup !== undefined ? w('engine.project.scriptsSetup', { command: setup }) : o.hint === 'none yet' ? w('engine.project.scriptsNone') : o.hint ?? '' };
      }
      case 'p-finder':
        return { ...o, label: openFolderLabel() };
      case 'p-newgroup':
        return { ...o, label: w('engine.project.newGroup'), hint: w('engine.project.newGroupHint') };
      case 'p-ungroup':
        return group ? { ...o, label: w('engine.project.ungroup', { name: group.name }) } : o;
      case 'p-agents': {
        const n = /\((\d+)\)…$/.exec(o.label)?.[1];
        return n ? { ...o, label: w('engine.project.agents', { n: num(n) }), hint: w('engine.project.agentsHint') } : o;
      }
      case 'p-hide':
        return { ...o, label: w('engine.project.hide'), hint: w('engine.project.hideHint') };
      default:
        if (o.id.startsWith('p-group:')) return { ...o, label: w('engine.project.moveTo', { name: o.id.slice('p-group:'.length) }), hint: w('engine.project.group') };
        return closeWords(o, w);
    }
  });
  return { ...spec, intro, options };
}

function guestAddWords(spec: MenuSpec, state: AppState, peerId: string, w: ReturnType<typeof say>): MenuSpec {
  const g = state.guests[peerId];
  if (!g) return spec;
  return {
    title: w('engine.guestAdd.title', { name: g.name }),
    intro: [w('engine.guestAdd.intro', { name: g.name, can: w(`common.CAN_INFO.${g.can}.short` as WordKey) })],
    options: spec.options.map((o) => (o.id.startsWith('ga:') ? (o.hint === 'already in' ? { ...o, hint: w('engine.guestAdd.alreadyIn') } : o) : closeWords(o, w))),
  };
}

function wsMoreWords(spec: MenuSpec, w: ReturnType<typeof say>, lang: Locale): MenuSpec {
  return {
    ...spec,
    title: spec.title === 'More' ? w('engine.menu.more') : spec.title,
    options: spec.options.map((o) => (o.id.startsWith('wsact:') ? { ...o, label: localButtonLabel(o.label, lang), ...(o.hint !== undefined ? { hint: localButtonHint(o.hint, lang) } : {}) } : closeWords(o, w))),
  };
}

const SETTINGS_SECTIONS = ['claude', 'notify', 'workspaces', 'terminal', 'env', 'buttons', 'people', 'display'] as const;

const SETTINGS_INTROS: Readonly<Record<string, WordKey>> = {
  'Saved to ~/.beluga/settings.json and used every time you run Beluga.': 'engine.settings.intro.main',
  'How your agent works, for you and for the people you let use it.': 'engine.settings.intro.claude',
  'Beluga tells you when something needs you, on the desktop and in the inbox (top right).': 'engine.settings.intro.notify1',
  'In the conversation you are looking at, only a long run of yours finishing is announced.': 'engine.settings.intro.notify2',
  'New worktrees, scripts, the terminal and the top bar.': 'engine.settings.intro.workspaces',
  'The shell your terminals run. New shells use it; open ones keep theirs.': 'engine.settings.intro.terminal',
  'Show only the workspace buttons you use. Hidden ones still work as /commands.': 'engine.settings.intro.buttons',
  'Pick how much you trust each person. Click someone to change it.': 'engine.settings.intro.people',
};

const SETTINGS_HINTS: Readonly<Record<string, WordKey>> = {
  'whatever the settings above say': 'engine.settings.hint.n-test',
  'back to the built-in ones': 'engine.settings.hint.set-pr-reset',
  'type KEY=value': 'engine.settings.hint.env-add',
};

/** A settings hint: its On/Off and "Enter to switch" in the language shown; anything else as it is. */
function settingsHint(hint: string, w: ReturnType<typeof say>): string {
  const fixed = SETTINGS_HINTS[hint];
  if (fixed) return w(fixed);
  const sw = '  ·  Enter to switch';
  const tail = hint.endsWith(sw) ? `  ·  ${w('engine.settings.enterToSwitch')}` : '';
  const body = tail ? hint.slice(0, -sw.length) : hint;
  const word = body === 'On' ? w('engine.settings.on') : body === 'Off' ? w('engine.settings.off') : body === '○ hidden' ? `○ ${w('engine.settings.hidden')}` : body === '◉ shown' ? `◉ ${w('engine.settings.shown')}` : undefined;
  if (word !== undefined) return word + tail;
  const lead = /^(On|Off)( {2}· {2}.*)$/.exec(body);
  if (lead && !tail) return (lead[1] === 'On' ? w('engine.settings.on') : w('engine.settings.off')) + lead[2]!;
  return hint;
}

function settingsWords(spec: MenuSpec, state: AppState, w: ReturnType<typeof say>, lang: Locale): MenuSpec {
  const title = spec.title === 'Settings' ? w('engine.settings.title') : (() => {
    const name = spec.title.startsWith('Settings › ') ? spec.title.slice('Settings › '.length) : undefined;
    const section = SETTINGS_SECTIONS.find((s) => EN[`engine.settings.section.${s}`] === name);
    return section ? w('engine.settings.titleOf', { section: w(`engine.settings.section.${section}`) }) : spec.title;
  })();
  const intro = spec.intro.map((line) => (SETTINGS_INTROS[line] ? w(SETTINGS_INTROS[line]!) : line));
  const options = spec.options.map((o): Option => {
    const key = `engine.settings.${o.id}`;
    const named = key in EN ? { label: w(key as WordKey) } : o.id.startsWith('btn:') ? { label: localButtonLabel(o.label, lang) } : {};
    const hint = o.id === 'set-name' && o.hint === `${state.self?.name ?? '–'}  ·  type a new one` ? w('engine.settings.hint.set-name', { name: state.self?.name ?? '–' }) : o.hint !== undefined ? settingsHint(o.hint, w) : undefined;
    return closeWords({ ...o, ...named, ...(hint !== undefined ? { hint } : {}) }, w);
  });
  return { title, intro, options };
}

/**
 * menuSpec in the language shown: the same options in the same order with the same ids (picking
 * one by its index runs the same action), only the words changed. Kinds not covered keep the
 * engine's English.
 */
export function localMenuSpec(state: AppState, menu: MenuKind, lang: Locale = currentLocale()): MenuSpec | undefined {
  const spec = menuSpec(state, menu);
  if (!spec || lang === 'en') return spec;
  const w = say(lang);
  switch (menu.kind) {
    case 'project':
      return projectWords(spec, state, menu.id, w);
    case 'guest_add':
      return guestAddWords(spec, state, menu.peerId, w);
    case 'ws_more':
      return wsMoreWords(spec, w, lang);
    case 'settings':
      return settingsWords(spec, state, w, lang);
    default:
      return spec;
  }
}

// ---------------------------------------------------------------- usage windows

/** A plan window's name ("5-hour", "Weekly", Codex's "Daily") and its short form, in the language shown. */
export function localWindow<W extends Pick<CardWindow, 'label' | 'short'>>(win: W, lang: Locale = currentLocale()): W {
  if (lang === 'en') return win;
  const w = say(lang);
  const fixed: Record<string, readonly [WordKey, WordKey]> = {
    '5-hour': ['engine.window.fiveHour', 'engine.window.short.fiveHour'],
    Weekly: ['engine.window.weekly', 'engine.window.short.weekly'],
    Daily: ['engine.window.daily', 'engine.window.short.daily'],
    Monthly: ['engine.window.monthly', 'engine.window.short.monthly'],
    Limit: ['engine.window.limit', 'engine.window.short.limit'],
  };
  const pair = fixed[win.label];
  if (pair) return { ...win, label: w(pair[0]), short: w(pair[1]) };
  const m = /^(\d+)-(day|hour|minute)$/.exec(win.label);
  if (!m) return win;
  const unit = m[2] === 'day' ? 'days' : m[2] === 'hour' ? 'hours' : 'minutes';
  return { ...win, label: w(`engine.window.${unit}`, { n: num(m[1]) }), short: w(`engine.window.short.${unit}`, { n: num(m[1]) }) };
}

// ---------------------------------------------------------------- shared files, models, the room

const ROOT_SUFFIXES: ReadonlyArray<readonly [string, WordKey]> = [
  [' (read-only)', 'engine.files.readOnly'],
  [' (shared with you)', 'engine.files.sharedWithYou'],
  [' (workspace)', 'engine.files.workspace'],
];

/** A shared folder's name on the Files page (⌘7): its "(read-only)" or "(workspace)" in the language shown. */
export function localRootLabel(label: string, lang: Locale = currentLocale()): string {
  if (lang === 'en') return label;
  const hit = ROOT_SUFFIXES.find(([suffix]) => label.endsWith(suffix));
  return hit ? label.slice(0, -hit[0].length) + say(lang)(hit[1]) : label;
}

/** A model's name where the engine says "Default" (modelLabel, the agent picker), in the language shown. */
export function localModelName(label: string, lang: Locale = currentLocale()): string {
  if (lang === 'en') return label;
  const w = say(lang);
  if (label === 'Default') return w('engine.model.default');
  return label.endsWith(' · Default') ? `${label.slice(0, -' · Default'.length)} · ${w('engine.model.default')}` : label;
}

/** A model's description where the engine says "Codex's choice", in the language shown. */
export function localModelDescription(text: string, lang: Locale = currentLocale()): string {
  if (lang === 'en') return text;
  const m = /^(.+)'s choice$/.exec(text);
  return m ? say(lang)('engine.model.choice', { name: m[1]! }) : text;
}

/** The Room as the call button names it ("Call the Room"). */
export const roomCallName = (lang: Locale = currentLocale()): string => (lang === 'en' ? 'the Room' : say(lang)('engine.room.callName'));
