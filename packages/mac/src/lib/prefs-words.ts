/**
 * Settings' option tables in the language shown (i18n/en/x-prefs.ts): the tables stay English in
 * src/ and the lib files the preferences load (themes, fire looks, accents), and the Mac finds
 * their words here by id. A word the dictionary doesn't have shows as the table's own English.
 * tests/mac-i18n-prefs.test.ts checks every id has its words, the English exactly the table's.
 */
import type { RuntimeChoice } from '../../../../src/shared/agent-runtimes.js';
import { KNOWN_RUNTIMES } from '../../../../src/shared/agent-runtimes.js';
import { type Locale, makeT } from '../../../../src/shared/i18n.js';
import { x_prefs } from '../i18n/en/x-prefs.js';
import { x_prefs as zh } from '../i18n/zh-CN/x-prefs.js';
import { type Key, currentLocale, t } from '../i18n/index.js';

const has = (key: string): key is Key => key in x_prefs;

/** `prefs.<table>.<id>` in the language shown, else `en`. */
export const pw = (table: string, id: string, en: string): string => {
  const key = `prefs.${table}.${id}`;
  return has(key) ? t(key) : en;
};

/** A toolbar button's name (HIDEABLE_BUTTONS): the file manager's by its own name (Finder, File Explorer, Files). */
export const buttonLabel = (id: string, en: string): string => (id === 'finder' ? pw('fileManager', en, en) : pw('button', id, en));

type Named = { readonly id: string; readonly name: string; readonly blurb: string };
/** A fire setup's, preset's or the welcome's starter's name and blurb (chat/fire-look.ts). */
export const fireName = (table: 'fireSetup' | 'firePreset' | 'fireStarter', x: Named): string => pw(table, `${x.id}.name`, x.name);
export const fireBlurb = (table: 'fireSetup' | 'firePreset' | 'fireStarter', x: Named): string => pw(table, `${x.id}.blurb`, x.blurb);
/** A built-in palette's name (yours keep the name you gave them). */
export const paletteName = (p: { readonly id: string; readonly name: string }, own: boolean): string => (own ? p.name : pw('firePalette', p.id, p.name));

/** A theme's name (lib/themes.ts): the generic ones translated, the well-known ones as they are. */
export const themeName = (th: { readonly id: string; readonly name: string }): string => pw('theme', th.id, th.name);

/** An accent swatch's name (lib/prefs.ts ACCENTS). */
export const accentName = (accent: string): string => pw('accent', accent, accent);

/** A Mac sound's name, as macOS shows it in the language shown. */
export const macSoundName = (id: string): string => pw('macSound', id, id);

/** A runtime's name (KNOWN_RUNTIMES): the local model's translated, the others are names. */
export const runtimeLabel = (id: string, en: string): string => (en === KNOWN_RUNTIMES.find((r) => r.id === id)?.label ? pw('runtime', `${id}.label`, en) : en);

/** The runtimes with their names and what's missing in the language shown, for a picker to list (never to save: AgentRefs keep the engine's label). */
export function shownRuntimes(runtimes: readonly RuntimeChoice[]): RuntimeChoice[] {
  return runtimes.map((r) => {
    const known = KNOWN_RUNTIMES.find((k) => k.id === r.id);
    const why = r.why !== undefined && r.why === known?.missing ? pw('runtime', `${r.id}.missing`, r.why) : r.why;
    return { ...r, label: runtimeLabel(r.id, r.label), ...(why !== undefined ? { why } : {}) };
  });
}

/** A voice language's name: 'auto' in words, the others in their own language. */
export const voiceLanguageName = (code: string, en: string): string => pw('voiceLanguage', code, en);

/** A thread limit row's words (src/shared/threads.ts THREAD_LIMIT_ROWS). */
export const threadLimitWords = (key: string, field: 'label' | 'detail' | 'find', en: string): string => pw('threadLimit', `${key}.${field}`, en);

/** The factor that put a computer ahead (src/shared/placement.ts factorWords), back to its key and number. */
type PrefsKey = keyof typeof x_prefs;
const sayIn = makeT(x_prefs, { 'zh-CN': zh });

const FACTORS: ReadonlyArray<readonly [RegExp, PrefsKey]> = [
  [/^the most free memory \((\d+) GB\)$/, 'prefs.placement.memory'],
  [/^the least busy CPU \((\d+)%\)$/, 'prefs.placement.load'],
  [/^the fewest tasks running \((\d+)\)$/, 'prefs.placement.agents'],
  [/^the most free disk \((\d+) GB\)$/, 'prefs.placement.disk'],
  [/^the quickest link \((\d+) ms\)$/, 'prefs.placement.link'],
];

const REASONS: Readonly<Record<string, PrefsKey>> = { offline: 'prefs.placement.offline', 'on another version': 'prefs.placement.otherVersion' };
/** The engine names the agent there ("<agent> isn’t signed in there"); the Mac says your agent. */
const reasonKey = (reason: string): PrefsKey => REASONS[reason] ?? 'prefs.placement.signedOut';

/**
 * Where new work runs and why (src/machines/placement.ts, src/shared/placement.ts), in the
 * language shown. The engine says it in English; the Mac reads its sentence back by shape.
 * One it doesn't know stays as the engine said it.
 */
export function placementWhy(why: string, locale: Locale = currentLocale()): string {
  if (locale === 'en') return why;
  const t = sayIn(locale);
  let m: RegExpMatchArray | null;
  if ((m = why.match(/^None of your computers is ready, so new work runs on (.+)\.$/))) return t('prefs.placement.noneReady', { here: m[1]! });
  if ((m = why.match(/^That computer is gone from your devices, so new work runs on (.+)\.$/))) return t('prefs.placement.gone', { here: m[1]! });
  if ((m = why.match(/^(.+) isn’t ready \((offline|on another version|[^()]+ isn’t signed in there)\), so new work runs on (.+) for now\.$/))) return t('prefs.placement.notReady', { name: m[1]!, reason: t(reasonKey(m[2]!)), here: m[3]! });
  if ((m = why.match(/^New work runs on (.+)\.$/))) return t('prefs.placement.runsOn', { name: m[1]! });
  if ((m = why.match(/^(.+) is the least busy right now\.$/))) return t('prefs.placement.leastBusy', { here: m[1]! });
  if (why === 'You have no computers paired.') return t('prefs.placement.noComputers');
  if ((m = why.match(/^(.+) is your only computer\.$/))) return t('prefs.placement.onlyComputer', { name: m[1]! });
  if ((m = why.match(/^(.+) is the only one that can take it\.$/))) return t('prefs.placement.onlyOne', { name: m[1]! });
  if ((m = why.match(/^(.+) and (.+) have as much room; \1 has the project already\.$/))) return t('prefs.placement.tieProject', { a: m[1]!, b: m[2]! });
  if ((m = why.match(/^(.+) and (.+) have as much room; \1 it is\.$/))) return t('prefs.placement.tie', { a: m[1]!, b: m[2]! });
  if ((m = why.match(/^(.+) has no tasks running\.$/))) return t('prefs.placement.noAgents', { name: m[1]! });
  if ((m = why.match(/^(.+) has (the .+)\.$/))) {
    const name = m[1]!;
    for (const [shape, key] of FACTORS) {
      const f = m[2]!.match(shape);
      if (f) return t(key, { name, n: f[1]! });
    }
  }
  return why;
}
