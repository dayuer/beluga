import type { TermColors } from '../../../../src/terminal/import/look.js';
import { Icon } from '../components/Icon.js';
import { Button, Segmented, cx } from '../components/ui.js';
import { termKeyRows, termKeysOf } from '../lib/term-keys.js';
import { colorsFor } from '../lib/terminal-import-model.js';
import type { TermThemePref } from '../lib/terminal-import-model.js';
import { fontStack, looksDark } from '../lib/terminal-look.js';
import { PRESET_FROM, TERMINAL_PRESETS } from '../lib/terminal-themes.js';
import { setPrefs, usePrefs } from '../lib/prefs.js';
import { Group, Row, Switch } from './settings-controls.js';
import t from './terminal-settings.module.css';
import { chordLabel } from '../lib/shortcuts-model.js';
import { useT } from '../i18n/index.js';

/** A theme's look in a few lines of a terminal, its own colours (Beluga's when it has none). */
function ThemeCard({ name, colors, on, onPick, font }: { readonly name: string; readonly colors: TermColors | undefined; readonly on: boolean; readonly onPick: () => void; readonly font: string }) {
  const a = (i: number): string | undefined => colors?.ansi[i] ?? undefined;
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={name} className={cx(t.themeCard, on && t.themeCardOn)} onClick={onPick}>
      <span className={t.themeLines} style={{ fontFamily: fontStack(font), ...(colors?.background ? { background: colors.background } : {}), ...(colors?.foreground ? { color: colors.foreground } : {}) }}>
        <span>
          <span style={{ color: a(2) ?? 'var(--ok)' }}>⏺</span> Read(auth.ts)
        </span>
        <span style={{ opacity: 0.55 }}>{'  ⎿ 214 lines'}</span>
        <span>
          <span style={{ color: a(4) ?? 'var(--info)' }}>{'>'}</span> fix the <span style={{ color: a(1) ?? 'var(--error)' }}>failing</span> test
        </span>
        <span style={{ color: a(3) ?? 'var(--warn)' }}>✻ Thinking…</span>
      </span>
      <span className={t.themeName}>
        {name}
        {on ? <Icon name="check" size={12} /> : null}
        <span className={t.themeDots} aria-hidden>
          {[1, 2, 3, 4, 5].map((i) => (
            <i key={i} style={{ background: a(i) ?? 'var(--hairline-strong)' }} />
          ))}
        </span>
      </span>
    </button>
  );
}

/**
 * The terminal's colours (BLG-536): Beluga's own, a theme you brought from another terminal, or a
 * well-known one. Each shows as it will look; one with light colours follows Beluga's appearance.
 */
export function ThemeGroup() {
  const tr = useT();
  const prefs = usePrefs();
  const dark = looksDark();
  const current = prefs.termTheme;
  const imported = current && current.from !== PRESET_FROM ? current : undefined;
  const pick = (theme: TermThemePref | null): void => setPrefs({ termTheme: theme });
  return (
    <Group title={tr('dialogs.termThemes.colours')}>
      <div className={t.themes} role="radiogroup" aria-label={tr('dialogs.termThemes.terminalColours')}>
        <ThemeCard name="Beluga" colors={undefined} font={prefs.termFont} on={!current} onPick={() => pick(null)} />
        {imported ? <ThemeCard name={imported.name} colors={colorsFor(imported, dark)} font={prefs.termFont} on onPick={() => pick(imported)} /> : null}
        {TERMINAL_PRESETS.map((p) => (
          <ThemeCard key={p.name} name={p.name} colors={colorsFor(p, dark)} font={prefs.termFont} on={current?.from === PRESET_FROM && current.name === p.name} onPick={() => pick(p)} />
        ))}
      </div>
    </Group>
  );
}

/**
 * The terminal view (BLG-534), for people who'd rather talk to Claude in Claude Code's own
 * terminal app: off by default (everyone has the chat); on, each conversation's header can show it
 * as the chat, the terminal, or both, and this picks how ones you haven't switched open.
 */
export function ViewGroup() {
  const tr = useT();
  const prefs = usePrefs();
  return (
    <Group title={tr('dialogs.termThemes.advanced')}>
      <Row label={tr('dialogs.termThemes.useTerminal')} detail={prefs.termView ? tr('dialogs.termThemes.useTerminalOn', { keys: chordLabel('Shift+Cmd+T') }) : tr('dialogs.termThemes.useTerminalOff')}>
        <Switch label={tr('dialogs.termThemes.useTerminal')} on={prefs.termView} onChange={(v) => setPrefs({ termView: v })} />
      </Row>
      {prefs.termView ? <Row label={tr('dialogs.termThemes.openAs')} detail={prefs.convoDefault === 'chat' ? tr('dialogs.termThemes.openChat') : prefs.convoDefault === 'terminal' ? tr('dialogs.termThemes.openTerminal') : tr('dialogs.termThemes.openBoth')}>
        <Segmented
          label={tr('dialogs.termThemes.openAs')}
          value={prefs.convoDefault}
          onChange={(v) => setPrefs({ convoDefault: v, convoDefaultPicked: true })}
          options={[
            { value: 'chat', label: tr('dialogs.termThemes.chat'), icon: 'chat' },
            { value: 'terminal', label: tr('dialogs.termThemes.terminal'), icon: 'terminal' },
            { value: 'both', label: tr('dialogs.termThemes.both'), icon: 'columns' },
          ]}
        />
      </Row> : null}
    </Group>
  );
}

/**
 * The terminal's keys (BLG-537): what each does, the ones you brought from your terminal marked,
 * and whether they win over Beluga's shortcuts while the keyboard is in the terminal.
 */
export function KeysGroup() {
  const tr = useT();
  const prefs = usePrefs();
  const rows = termKeyRows(termKeysOf(prefs.termKeys?.keys, prefs.termKeys?.from));
  return (
    <Group title={tr('dialogs.termThemes.keysTitle')}>
      <Row label={tr('dialogs.termThemes.keysFirst')} detail={prefs.termKeysFirst ? tr('dialogs.termThemes.keysFirstOn', { keys: ['Cmd+T', 'Cmd+W', 'Cmd+1'].map(chordLabel).join(', ') }) : tr('dialogs.termThemes.keysFirstOff')}>
        <Switch label={tr('dialogs.termThemes.keysFirst')} on={prefs.termKeysFirst} onChange={(v) => setPrefs({ termKeysFirst: v })} />
      </Row>
      <div className={t.keyList} role="list" aria-label={tr('dialogs.termThemes.terminalKeys')}>
        {rows.map((r) => (
          <div key={r.label} className={t.keyRow} role="listitem">
            <span>{r.label}</span>
            {r.from ? <span className={t.keyFrom}>{tr('dialogs.termThemes.from', { name: r.from })}</span> : null}
            <span className={t.keyKeys}>{r.keys}</span>
          </div>
        ))}
      </div>
      {prefs.termKeys?.keys.length ? (
        <Row label={tr('dialogs.termThemes.keysFrom', { n: prefs.termKeys.keys.length, from: prefs.termKeys.from || tr('dialogs.termThemes.yourTerminal') })} detail={tr('dialogs.termThemes.brought')}>
          <Button size="small" onClick={() => setPrefs({ termKeys: null })}>
            {tr('dialogs.termThemes.useBeluga')}
          </Button>
        </Row>
      ) : null}
    </Group>
  );
}
