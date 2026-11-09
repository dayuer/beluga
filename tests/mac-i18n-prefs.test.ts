import { describe, expect, it } from 'vitest';
import { HIDEABLE_BUTTONS } from '../src/ui/settings-menus.js';
import { fileManagerFor } from '../src/shared/assistant.js';
import { MAC_SOUNDS } from '../src/shared/notify-sound.js';
import { KNOWN_RUNTIMES } from '../src/shared/agent-runtimes.js';
import { VOICE_LANGUAGES } from '../src/shared/voice-models.js';
import { THREAD_LIMIT_ROWS } from '../src/shared/threads.js';
import { placeNewWork } from '../src/machines/placement.js';

// The Mac app's own modules through a variable: the root typecheck can't follow its @beluga paths (its own tsc checks them).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the module types are checked by the Mac app's own tsc
const mac = (file: string): Promise<any> => import(`../packages/mac/src/${file}`) as Promise<any>;
const { PALETTES, PRESETS, SETUPS, STARTERS } = await mac('chat/fire-look.js');
const { THEMES } = await mac('lib/themes.js');
const { ACCENTS } = await mac('lib/prefs.js');
const words = await mac('lib/prefs-words.js');
const en: Record<string, string> = (await mac('i18n/en/x-prefs.js')).x_prefs;
const zh: Record<string, string> = (await mac('i18n/zh-CN/x-prefs.js')).x_prefs;

type Rows = ReadonlyArray<readonly [string, string]>;
const named = (table: string, list: ReadonlyArray<{ id: string; name: string; blurb: string }>): Rows => list.flatMap((x) => [[`${table}.${x.id}.name`, x.name], [`${table}.${x.id}.blurb`, x.blurb]] as const);

/** Settings' option tables the Mac shows in your language by id (lib/prefs-words.ts). */
const TABLES: Readonly<Record<string, Rows>> = {
  buttons: HIDEABLE_BUTTONS.filter(([id]) => id !== 'finder').map(([id, label]) => [`button.${id}`, label] as const),
  fileManagers: (['mac', 'windows', 'linux'] as const).map((k) => [`fileManager.${fileManagerFor(k)}`, fileManagerFor(k)] as const),
  fireSetups: named('fireSetup', SETUPS),
  firePresets: named('firePreset', PRESETS),
  fireStarters: named('fireStarter', STARTERS),
  firePalettes: PALETTES.map((p: { id: string; name: string }) => [`firePalette.${p.id}`, p.name] as const),
  themes: THEMES.map((th: { id: string; name: string }) => [`theme.${th.id}`, th.name] as const),
  accents: Object.keys(ACCENTS)
    .filter((a) => a !== 'theme')
    .map((a) => [`accent.${a}`, a] as const),
  macSounds: MAC_SOUNDS.map((s) => [`macSound.${s}`, s] as const),
  local: KNOWN_RUNTIMES.filter((r) => r.id === 'local').flatMap((r) => [[`runtime.local.label`, r.label], [`runtime.local.missing`, r.missing]] as const),
  voiceAuto: VOICE_LANGUAGES.filter((l) => l.code === 'auto').map((l) => [`voiceLanguage.auto`, l.label] as const),
  threadLimits: THREAD_LIMIT_ROWS.flatMap((r) => [[`threadLimit.${r.key}.label`, r.label], [`threadLimit.${r.key}.detail`, r.detail]] as const),
};

describe("Settings' option tables, in both languages", () => {
  for (const [table, rows] of Object.entries(TABLES)) {
    it(`${table}: every id has its words, the English exactly the table's`, () => {
      expect(rows.length).toBeGreaterThan(0);
      for (const [path, english] of rows) {
        const key = `prefs.${path}`;
        expect(en[key], key).toBe(english);
        expect(zh[key], key).toBeTruthy();
      }
    });
  }

  it('the English window reads exactly as before', () => {
    for (const [id, label] of HIDEABLE_BUTTONS) expect(words.buttonLabel(id, label)).toBe(label);
    for (const th of THEMES) expect(words.themeName(th)).toBe(th.name);
    expect(words.macSoundName('Submarine')).toBe('Submarine');
    const why = 'Studio and Mini have as much room; Studio has the project already.';
    expect(words.placementWhy(why)).toBe(why);
  });
});

describe('where new work runs, in Chinese', () => {
  it('reads the engine’s sentences back by shape, and leaves one it doesn’t know', () => {
    const zhWhy = (why: string): string => words.placementWhy(why, 'zh-CN');
    expect(zhWhy(placeNewWork('here', [], { name: 'MacBook' }).why)).toBe('新任务在 MacBook 上运行。');
    expect(zhWhy(placeNewWork('gone', [], { name: 'MacBook' }).why)).toBe('那台电脑已经不在你的设备里了，新任务在 MacBook 上运行。');
    expect(zhWhy(placeNewWork('best', [], { name: 'MacBook' }).why)).toBe('你的电脑都还没准备好，新任务先在 MacBook 上运行。');
    expect(zhWhy('Studio isn’t ready (offline), so new work runs on MacBook for now.')).toBe('Studio 还没准备好（离线），新任务暂时在 MacBook 上运行。');
    expect(zhWhy('Studio and Mini have as much room; Studio it is.')).toBe('Studio 和 Mini 一样空闲；就用 Studio。');
    expect(zhWhy('Studio has the most free memory (25 GB).')).toBe('Studio 的空闲内存最多（25 GB）。');
    expect(zhWhy('Studio has no tasks running.')).toBe('Studio 上没有在运行的任务。');
    expect(zhWhy('Something new.')).toBe('Something new.');
    expect(words.placementWhy('Studio has no tasks running.', 'en')).toBe('Studio has no tasks running.');
  });
});
