import { useEffect, useState } from 'react';
import { joinArgs, shellName, splitArgs } from '@beluga/shared/shells.js';
import { Segmented, cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { setPrefs, usePrefs } from '../lib/prefs.js';
import { SCROLLBACK_CHOICES, fontChoices } from '../lib/terminal-look.js';
import { ImportGroup, TermPreview } from './TerminalImport.js';
import { KeysGroup, ThemeGroup, ViewGroup } from './TerminalThemes.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';
import t from './terminal-settings.module.css';
import { shortcutKeys } from '../lib/shortcuts.js';
import { thisComputer } from '../lib/os-words.js';
import { keyPlatform, type KeyPlatform } from '../lib/shortcuts-model.js';
import { type Key, useT } from '../i18n/index.js';

const OTHER = '__other';

/** A shell's full path as this computer writes one, and an example (Homebrew's fish on a Mac). */
const SHELL_PATH: Readonly<Record<KeyPlatform, { readonly full: RegExp; readonly start: Key; readonly example: string }>> = {
  mac: { full: /^\//, start: 'settings.terminal.startSlash', example: '/opt/homebrew/bin/fish' },
  linux: { full: /^\//, start: 'settings.terminal.startSlash', example: '/usr/bin/fish' },
  windows: { full: /^([a-z]:[\\/]|\\\\)/i, start: 'settings.terminal.startDrive', example: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
};

/** Which shell new terminals run, and how it starts (Beluga's setting, not just this window's). */
function ShellGroup() {
  const api = useApi();
  const p = useApp((st) => st.prefs);
  const choices = useApp((st) => st.shellChoices);
  const tr = useT();
  const login = choices.find((c) => c.isDefault);
  const listed = !p.shell || choices.some((c) => c.path === p.shell);
  const [other, setOther] = useState(!listed);
  const [path, setPath] = useState(listed ? '' : (p.shell ?? ''));
  const [args, setArgs] = useState(joinArgs(p.shellArgs));
  useEffect(() => {
    setArgs(joinArgs(p.shellArgs));
  }, [p.shellArgs]);
  const picked = other ? OTHER : (p.shell ?? '');
  const shellPath = SHELL_PATH[keyPlatform()];
  const savePath = (): void => {
    const next = path.trim();
    if (next && next !== p.shell) void api.session.setPrefs({ shell: next });
  };
  return (
    <Group title={tr('settings.terminal.shell')}>
      <Row label={tr('settings.terminal.shell')} detail={other ? tr('settings.terminal.fullPath') : picked ? picked : tr('settings.terminal.yourLogin', { path: login ? `, ${login.path}` : '' })}>
        <Select
          label={tr('settings.terminal.shell')}
          value={picked}
          onChange={(v) => {
            setOther(v === OTHER);
            // The login shell is "no shell set": null, since JSON drops undefined on the way to the daemon.
            if (v !== OTHER) void api.session.setPrefs({ shell: v || null });
          }}
          options={[
            { value: '', label: login ? tr('settings.terminal.loginNamed', { name: login.name }) : tr('settings.terminal.login') },
            ...choices.filter((c) => !c.isDefault || p.shell === c.path).map((c) => ({ value: c.path, label: choices.filter((x) => x.name === c.name).length > 1 ? `${c.name} · ${c.path}` : c.name })),
            { value: OTHER, label: tr('settings.terminal.other') },
          ]}
        />
      </Row>
      {other ? (
        <Row label={tr('settings.terminal.path')} detail={path && !shellPath.full.test(path) ? tr('settings.terminal.pathHint', { start: tr(shellPath.start), example: shellPath.example }) : path ? tr('settings.terminal.runs', { name: shellName(path) }) : undefined}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              savePath();
            }}
          >
            <input className={cx(s.text, t.mono)} aria-label={tr('settings.terminal.shellPath')} value={path} placeholder={shellPath.example} spellCheck={false} onChange={(e) => setPath(e.target.value)} onBlur={savePath} />
          </form>
        </Row>
      ) : null}
      <Row label={tr('settings.terminal.login')} detail={tr('settings.terminal.loginDetail')}>
        <Switch label={tr('settings.terminal.login')} on={p.shellLogin} onChange={(v) => void api.session.setPrefs({ shellLogin: v })} />
      </Row>
      <Row label={tr('settings.terminal.extraArgs')} detail={tr('settings.terminal.startedAs', { cmd: [p.shell ? shellName(p.shell) : (login?.name ?? 'shell'), ...(p.shellLogin ? ['-l'] : []), ...splitArgs(args)].join(' ') })}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            (e.currentTarget.elements[0] as HTMLInputElement).blur();
          }}
        >
          <input className={cx(s.text, t.mono)} aria-label={tr('settings.terminal.extraArgs')} value={args} placeholder={tr('settings.common.none')} spellCheck={false} onChange={(e) => setArgs(e.target.value)} onBlur={() => joinArgs(splitArgs(args)) !== joinArgs(p.shellArgs) && void api.session.setPrefs({ shellArgs: splitArgs(args).slice(0, 20) })} />
        </form>
      </Row>
    </Group>
  );
}

/** How the terminal looks in this window (kept on this computer). */
function LookGroup() {
  const prefs = usePrefs();
  const tr = useT();
  return (
    <Group title={tr('settings.terminal.lookOn', { computer: thisComputer() })}>
      <div className={t.previewRow}>
        <TermPreview prefs={prefs} />
      </div>
      <Row label={tr('settings.terminal.font')}>
        <Select label={tr('settings.terminal.fontAria')} value={prefs.termFont} onChange={(v) => setPrefs({ termFont: v })} options={fontChoices(prefs.termFont)} />
      </Row>
      <Row label={tr('settings.terminal.size')} detail={`${prefs.termFontSize} pt`}>
        <input className={s.slider} aria-label={tr('settings.terminal.sizeAria')} type="range" min={9} max={22} step={0.5} value={prefs.termFontSize} onChange={(e) => setPrefs({ termFontSize: Number(e.target.value) })} />
      </Row>
      <Row label={tr('settings.terminal.lineHeight')} detail={`${prefs.termLineHeight.toFixed(2)}×`}>
        <input className={s.slider} aria-label={tr('settings.terminal.lineHeightAria')} type="range" min={1} max={1.6} step={0.02} value={prefs.termLineHeight} onChange={(e) => setPrefs({ termLineHeight: Number(e.target.value) })} />
      </Row>
      <Row label={tr('settings.terminal.cursor')}>
        <Segmented
          label={tr('settings.terminal.cursorStyle')}
          value={prefs.termCursor}
          onChange={(v) => setPrefs({ termCursor: v })}
          options={[
            { value: 'block', label: tr('settings.terminal.block') },
            { value: 'bar', label: tr('settings.terminal.bar') },
            { value: 'underline', label: tr('settings.terminal.underline') },
          ]}
        />
      </Row>
      <Row label={tr('settings.terminal.blink')}>
        <Switch label={tr('settings.terminal.blink')} on={prefs.termCursorBlink} onChange={(v) => setPrefs({ termCursorBlink: v })} />
      </Row>
      <Row label={tr('settings.terminal.scrollback')} detail={tr('settings.terminal.scrollbackDetail')}>
        <Select label={tr('settings.terminal.scrollback')} value={String(prefs.termScrollback)} onChange={(v) => setPrefs({ termScrollback: Number(v) })} options={SCROLLBACK_CHOICES.map((n) => ({ value: String(n), label: tr('settings.terminal.lines', { n: n.toLocaleString() }) }))} />
      </Row>
      {/* Only a Mac's Option key types special characters; Alt is already Meta elsewhere. */}
      {keyPlatform() === 'mac' ? (
        <Row label={tr('settings.terminal.optionMeta')} detail={prefs.termOptionMeta ? tr('settings.terminal.optionMetaOn') : tr('settings.terminal.optionMetaOff')}>
          <Switch label={tr('settings.terminal.optionMeta')} on={prefs.termOptionMeta} onChange={(v) => setPrefs({ termOptionMeta: v })} />
        </Row>
      ) : null}
    </Group>
  );
}

/** Where ⌘J (and Run) show the terminal in this window: the drawer under the chat or the right panel. */
function PlaceGroup() {
  const prefs = usePrefs();
  const tr = useT();
  return (
    <Group title={tr('settings.terminal.inWindow')}>
      <Row label={tr('settings.terminal.opens', { keys: shortcutKeys('toggle-dock') ?? tr('settings.terminal.toggle') })} detail={prefs.termIn === 'drawer' ? tr('settings.terminal.drawerDetail') : tr('settings.terminal.panelDetail')}>
        <Segmented
          label={tr('settings.terminal.whereOpens')}
          value={prefs.termIn}
          onChange={(v) => setPrefs({ termIn: v, ...(v === 'panel' ? { drawer: false } : {}) })}
          options={[
            { value: 'drawer', label: tr('settings.terminal.drawer'), icon: 'panelBottom' },
            { value: 'panel', label: tr('settings.terminal.panel'), icon: 'panelRight' },
          ]}
        />
      </Row>
    </Group>
  );
}

/** Settings › Terminal: the shell (for every screen), where it opens and how terminals look here. */
export function TerminalSettings() {
  const prefs = usePrefs();
  const tr = useT();
  return (
    <>
      <PlaceGroup />
      <ShellGroup />
      <ImportGroup />
      <ThemeGroup />
      <LookGroup />
      <ViewGroup />
      {prefs.termView ? <KeysGroup /> : null}
      <p className={t.note}>{tr('settings.terminal.note')}</p>
    </>
  );
}
