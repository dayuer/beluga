import { describe, expect, it } from 'vitest';
import { TRUST_INFO } from '../src/core/trust.js';
import { CAN_INFO } from '../src/shared/invites.js';
import { CAP_INFO, CAP_LEVEL_INFO, DECISION_INFO, EXPIRY_INFO } from '../src/core/gateway/access.js';
import { PRIORITY_INFO, SECTION_INFO, STATUS_INFO } from '../src/core/board/model.js';
import { LABEL_COLOR_INFO } from '../src/core/board/labels.js';
import { AUTONOMY_INFO, TESTS_AT_INFO } from '../src/core/plans/model.js';
import { ACCESS_INFO, DAY_NAMES, KEEP_CHATS_INFO, RUN_STATE_INFO, SERVICE_PRESETS, STEP_INFO, TRIGGER_INFO } from '../src/core/sentinel/model.js';
import { COMPARE_LABEL, COMPARE_WORDS } from '../src/core/sentinel/metrics.js';
import { TILE_INFO, TILE_STATE_WORDS, WIDTH_WORDS } from '../src/core/sentinel/dashboard-model.js';
import { EDGE_VERB, KIND_NAME, STATUS_INFO as GRAPH_STATUS_INFO } from '../src/shared/render/graph-model.js';
import { EXPERIMENT_INFO } from '../src/shared/experiments.js';
import { THREAD_WORDS } from '../src/shared/threads.js';
import { DND_CHOICES } from '../src/shared/quiet.js';
import { TUNNEL_LABELS } from '../src/ui/settings-menus.js';
import { SOUND_GROUPS } from '../src/shared/notify-sound.js';

// The Mac app's own modules through a variable: the root typecheck can't follow its @beluga paths (its own tsc checks them).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the module types are checked by the Mac app's own tsc
const mac = (file: string): Promise<any> => import(`../packages/mac/src/${file}`) as Promise<any>;
const { PANEL_LABELS } = await mac('lib/panel-model.js');
const { MCP_STATUS } = await mac('lib/mcp.js');
const { FAMILY_LABELS } = await mac('lib/sounds/catalog.js');
const { ACTION_LABELS } = await mac('lib/sounds/access-model.js');
const en: Record<string, unknown> = (await mac('i18n/en/common.js')).common;
const zh: Record<string, unknown> = (await mac('i18n/zh-CN/common.js')).common;

/**
 * The shared label tables the Mac shows through `tl()` (packages/mac/src/i18n/index.ts): every id
 * and field has its `common.<TABLE>.<id>.<field>` words in English (exactly the table's, so the
 * English window reads as before) and in Chinese. A new id in a table fails here until it has both.
 */
type Rows = ReadonlyArray<readonly [string, string]>;
const fields =
  (...names: string[]) =>
  (table: Readonly<Record<string, object>>): Rows =>
    Object.entries(table).flatMap(([id, v]) => names.map((f) => [`${id}.${f}`, (v as Record<string, string>)[f]!] as const));
const text =
  (field = 'text') =>
  (table: Readonly<Record<string | number, string>>): Rows =>
    Object.entries(table).map(([id, v]) => [`${id}.${field}`, v] as const);

const TABLES: Readonly<Record<string, Rows>> = {
  TRUST_INFO: fields('label', 'short', 'detail')(TRUST_INFO),
  CAN_INFO: fields('label', 'short', 'detail')(CAN_INFO),
  CAP_INFO: fields('label', 'detail', 'doing')(CAP_INFO),
  CAP_LEVEL_INFO: text('label')(CAP_LEVEL_INFO),
  EXPIRY_INFO: text('label')(EXPIRY_INFO),
  DECISION_INFO: text('label')(DECISION_INFO),
  STATUS_INFO: fields('label')(STATUS_INFO),
  PRIORITY_INFO: fields('label')(PRIORITY_INFO),
  SECTION_INFO: fields('label', 'hint')(SECTION_INFO),
  LABEL_COLOR_INFO: fields('label')(LABEL_COLOR_INFO),
  AUTONOMY_INFO: fields('label', 'summary', 'hint')(AUTONOMY_INFO),
  TESTS_AT_INFO: fields('label', 'hint')(TESTS_AT_INFO),
  KEEP_CHATS_INFO: fields('label', 'description', 'keeps')(KEEP_CHATS_INFO),
  TRIGGER_INFO: fields('label')(TRIGGER_INFO),
  STEP_INFO: fields('label', 'hint')(STEP_INFO),
  ACCESS_INFO: fields('label', 'sentence')(ACCESS_INFO),
  RUN_STATE_INFO: fields('label')(RUN_STATE_INFO),
  SERVICE_PRESETS: Object.entries(SERVICE_PRESETS).flatMap(([id, v]) => [[`${id}.label`, v.label], [`${id}.line`, v.line], ...(v.note ? [[`${id}.note`, v.note] as const] : [])] as const),
  DAY_NAMES: text()(Object.fromEntries(DAY_NAMES.map((d, i) => [i, d]))),
  COMPARE_LABEL: text('label')(COMPARE_LABEL),
  COMPARE_WORDS: text('label')(COMPARE_WORDS),
  TILE_INFO: fields('label', 'hint')(TILE_INFO),
  WIDTH_WORDS: text('label')(WIDTH_WORDS),
  TILE_STATE_WORDS: text('label')(TILE_STATE_WORDS),
  GRAPH_STATUS_INFO: fields('label')(GRAPH_STATUS_INFO),
  GRAPH_KIND_NAME: text()(KIND_NAME),
  GRAPH_EDGE_VERB: fields('out', 'in')(EDGE_VERB),
  EXPERIMENT_INFO: Object.entries(EXPERIMENT_INFO).flatMap(([id, v]) => [[`${id}.title`, v.title], [`${id}.summary`, v.summary], ...v.changes.map((c, i) => [`${id}.changes.${i}`, c] as const), [`${id}.cost`, v.cost]] as const),
  THREAD_WORDS: text()(THREAD_WORDS),
  DND_CHOICES: DND_CHOICES.map((c) => [`${c.value}.label`, c.label] as const),
  TUNNEL_LABELS: text()(TUNNEL_LABELS),
  PANEL_LABELS: text()(PANEL_LABELS),
  MCP_STATUS: fields('words')(MCP_STATUS),
  FAMILY_LABELS: text()(FAMILY_LABELS),
  ACTION_LABELS: text()(ACTION_LABELS),
  // dialogs/sound/SoundSettings.tsx keeps its own English for these (not exported); the ids are the engine's.
  GROUP_LABELS: SOUND_GROUPS.map((g) => [`${g}.text`, (en as Record<string, string>)[`common.GROUP_LABELS.${g}.text`] ?? ''] as const),
};

describe('the shared label tables, in both languages', () => {
  for (const [table, rows] of Object.entries(TABLES)) {
    it(`${table}: every id and field has its words, the English exactly the table's`, () => {
      expect(rows.length).toBeGreaterThan(0);
      for (const [path, english] of rows) {
        const key = `common.${table}.${path}`;
        expect((en as Record<string, unknown>)[key], key).toBe(english);
        expect(english, key).toBeTruthy();
        expect(typeof (zh as Record<string, unknown>)[key], key).toBe('string');
        expect((zh as Record<string, string>)[key], key).not.toBe('');
      }
    });
  }

  it('no `common.<TABLE>.` words for a table, id or field that is gone', () => {
    const known = new Set(Object.entries(TABLES).flatMap(([table, rows]) => rows.map(([path]) => `common.${table}.${path}`)));
    const stale = Object.keys(en).filter((k) => /^common\.[A-Z][A-Z0-9_]*\./.test(k) && !known.has(k));
    expect(stale).toEqual([]);
  });
});
