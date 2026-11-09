import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon.js';
import { Button, cx } from '../components/ui.js';
import { useBeluga } from '../lib/beluga.js';
import { DEFAULT_SHORTCUT } from '../lib/dictation-model.js';
import { getPrefs, setPrefs, usePrefs } from '../lib/prefs.js';
import { otherKeyShortcut } from '../chat/send-action.js';
import { setRecording, useBindings } from '../lib/shortcuts.js';
import {
  type AssignMode,
  BUILT_IN,
  SECTIONS,
  SHORTCUTS,
  type ShortcutDef,
  type ShortcutOverrides,
  TALK_ID,
  accelOfChord,
  assign,
  builtInFor,
  caveat,
  chordLabel,
  chordOf,
  clashesWith,
  heldLabel,
  isChanged,
  isModifierOnly,
  refusal,
  resetOne,
  searchShortcuts,
  sectionLabel,
  shortcutDef,
  unassign,
} from '../lib/shortcuts-model.js';
import { showUndo } from '../lib/undo-toast.js';
import { Group } from './settings-controls.js';
import s from './settings.module.css';
import k from './keyboard.module.css';
import { osName } from '../lib/os-words.js';
import { useT } from '../i18n/index.js';

/** The most keys one shortcut keeps. */
const MAX_KEYS = 3;
const FLASH_MS = 1400;

interface Slot {
  readonly id: string;
  /** Which of its keys (its count: a new one). */
  readonly slot: number;
}

interface Clash extends Slot {
  readonly chord: string;
  readonly others: readonly string[];
}

/** Save new overrides; the talk shortcut among them goes to its own setting (Settings › Voice). */
function save(next: ShortcutOverrides): void {
  const { [TALK_ID]: talk, ...rest } = next;
  setPrefs({ shortcuts: rest, ...(talk ? { voiceShortcut: talk[0] ? (accelOfChord(talk[0]) ?? '') : '' } : {}) });
}

const noMods = (e: KeyboardEvent): boolean => !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;

/**
 * Settings › Keyboard (BLG-289): every shortcut, yours to change. Click a key and press the new
 * one; a key something else has asks whether to swap them or take it; ⌘Q and the like stay
 * macOS's. Find a shortcut by its name, or by pressing its keys (and see what's free).
 */
export function KeyboardSettings() {
  const { ui } = useBeluga();
  const prefs = usePrefs();
  const bindings = useBindings();
  const t = useT();
  const [query, setQuery] = useState('');
  const [byKeys, setByKeys] = useState(false);
  const [keyQuery, setKeyQuery] = useState<string>();
  const [rec, setRec] = useState<Slot>();
  const [held, setHeld] = useState('');
  const [problem, setProblem] = useState<{ id: string; text: string }>();
  const [shake, setShake] = useState(0);
  const [clash, setClash] = useState<Clash>();
  const [flash, setFlash] = useState<readonly string[]>([]);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const listening = Boolean(rec || byKeys || clash);
  // No shortcut (and no menu-bar key) runs while you're pressing keys here.
  useEffect(() => {
    setRecording(listening);
  }, [listening]);
  useEffect(() => () => setRecording(false), []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const lit = (ids: readonly string[]): void => {
    setFlash(ids);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash([]), FLASH_MS);
  };

  const stop = (): void => {
    setRec(undefined);
    setHeld('');
  };

  const start = (id: string, slot: number): void => {
    setClash(undefined);
    setProblem(undefined);
    setByKeys(false);
    setHeld('');
    setRec({ id, slot });
  };

  const commit = (id: string, slot: number, chord: string, mode: AssignMode, others: readonly string[] = []): void => {
    save(assign(getPrefs().shortcuts, bindings, id, slot, chord, mode));
    setClash(undefined);
    stop();
    lit([id, ...others]);
  };

  const remove = (id: string, slot: number): void => {
    save(unassign(getPrefs().shortcuts, bindings, id, slot));
    setProblem(undefined);
    stop();
    lit([id]);
  };

  const reset = (id: string): void => {
    if (id === TALK_ID) setPrefs({ voiceShortcut: DEFAULT_SHORTCUT });
    else save(resetOne(getPrefs().shortcuts, id));
    setProblem(undefined);
    lit([id]);
  };

  const changed = SHORTCUTS.filter((d) => (d.id === TALK_ID ? prefs.voiceShortcut !== DEFAULT_SHORTCUT : isChanged(prefs.shortcuts, d.id)));
  const resetAll = (): void => {
    const before = { shortcuts: prefs.shortcuts, voiceShortcut: prefs.voiceShortcut };
    setPrefs({ shortcuts: {}, voiceShortcut: DEFAULT_SHORTCUT });
    stop();
    setClash(undefined);
    lit(changed.map((d) => d.id));
    showUndo(t('settings.keyboard.allBack'), () => setPrefs(before));
  };

  // The recorder: the next keys pressed. Capture, so nothing else in the window hears them.
  useEffect(() => {
    if (!rec && !byKeys) return;
    const down = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (isModifierOnly(e)) return setHeld(heldLabel(e));
      if (e.key === 'Escape' && noMods(e)) {
        setByKeys(false);
        setProblem(undefined);
        return stop();
      }
      const chord = chordOf(e);
      if (!chord) return;
      if (byKeys) {
        setKeyQuery(chord);
        setQuery('');
        setByKeys(false);
        return setHeld('');
      }
      if (!rec) return;
      const mine = bindings[rec.id] ?? [];
      // ⌫ on a key takes it away.
      if ((e.key === 'Backspace' || e.key === 'Delete') && noMods(e)) {
        if (rec.slot < mine.length) return remove(rec.id, rec.slot);
        return stop();
      }
      const why = refusal(rec.id, chord);
      if (why) {
        setProblem({ id: rec.id, text: why });
        setShake((n) => n + 1);
        return setHeld('');
      }
      setProblem(undefined);
      if (mine.includes(chord)) {
        // Already one of its keys: nothing changes.
        lit([rec.id]);
        return stop();
      }
      const others = clashesWith(bindings, rec.id, chord);
      if (others.length) {
        setClash({ ...rec, chord, others });
        return stop();
      }
      commit(rec.id, rec.slot, chord, 'replace');
    };
    const up = (e: KeyboardEvent): void => setHeld(heldLabel(e));
    const away = (): void => {
      setByKeys(false);
      stop();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', away);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', away);
    };
  }, [rec, byKeys, bindings]);

  // A clash waiting for you: ↩ takes the key, esc keeps things as they were.
  useEffect(() => {
    if (!clash) return;
    // It opens under its row, which may sit at the bottom: bring it into view.
    document.getElementById('kb-clash')?.scrollIntoView({ block: 'nearest', behavior: getPrefs().reduceMotion ? 'auto' : 'smooth' });
    const down = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') commit(clash.id, clash.slot, clash.chord, 'replace', clash.others);
      else setClash(undefined);
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [clash, bindings]);

  // Show the row a clash names (it may be scrolled away), and light it.
  const reveal = (id: string): void => {
    document.getElementById(`kb-${id}`)?.scrollIntoView({ block: 'center', behavior: prefs.reduceMotion ? 'auto' : 'smooth' });
    lit([id]);
  };

  const shown = useMemo(() => {
    const list = keyQuery ? SHORTCUTS.filter((d) => (bindings[d.id] ?? []).includes(keyQuery)) : searchShortcuts(bindings, query);
    return SECTIONS.map((section) => [section, list.filter((d) => d.section === section)] as const).filter(([, l]) => l.length);
  }, [bindings, query, keyQuery]);

  const builtIn = keyQuery ? builtInFor(keyQuery) : undefined;
  const builtInRows = BUILT_IN.filter(([chord, label]) => (keyQuery ? chord === keyQuery : !query.trim() || `${label} ${chordLabel(chord)}`.toLowerCase().includes(query.trim().toLowerCase())));

  const row = (def: ShortcutDef) => {
    // ⌥↩ is named for what it does with your default during a turn: Steer, or Queue.
    const d = def.id === 'composer-steer' ? { ...def, ...otherKeyShortcut(prefs.sendDuringTurn) } : def;
    const keys = bindings[d.id] ?? [];
    const recording = rec?.id === d.id;
    const bad = problem?.id === d.id ? problem.text : undefined;
    const note = keys.map((c) => caveat(d.id, c)).find(Boolean);
    const isChangedRow = d.id === TALK_ID ? prefs.voiceShortcut !== DEFAULT_SHORTCUT : isChanged(prefs.shortcuts, d.id);
    const detail = bad ?? (recording ? (rec.slot < keys.length ? t('settings.keyboard.pressNew') : t('settings.keyboard.press')) : (note ?? d.hint));
    const live = (
      <span key={`rec-${shake}`} className={cx(k.chip, k.recording, bad && k.shake)} aria-live="polite">
        {held ? `${held}…` : t('settings.keyboard.pressKeys')}
      </span>
    );
    return (
      <div key={d.id}>
        <div id={`kb-${d.id}`} className={cx(s.row, k.row, flash.includes(d.id) && k.flash, recording && k.rowOn)}>
          <div className={s.rowText}>
            <div className={s.rowLabel}>{d.label}</div>
            {detail ? <div className={cx(s.rowDetail, bad && k.bad)}>{detail}</div> : null}
          </div>
          <div className={k.keys}>
            {keys.map((c, i) =>
              recording && rec.slot === i ? (
                live
              ) : (
                <span key={c} className={k.chipWrap}>
                  <button type="button" className={k.chip} title={t('settings.keyboard.clickThenPress')} aria-label={t('settings.keyboard.changeAria', { label: d.label, keys: chordLabel(c) })} onClick={() => start(d.id, i)}>
                    {chordLabel(c)}
                  </button>
                  <button type="button" className={k.remove} aria-label={t('settings.keyboard.removeAria', { keys: chordLabel(c) })} title={t('settings.common.remove')} onClick={() => remove(d.id, i)}>
                    <Icon name="x" size={8} />
                  </button>
                </span>
              ),
            )}
            {recording && rec.slot >= keys.length ? (
              live
            ) : keys.length < MAX_KEYS ? (
              <button type="button" className={cx(k.add, !keys.length && k.addEmpty)} aria-label={keys.length ? t('settings.keyboard.anotherFor', { label: d.label }) : t('settings.keyboard.addFor', { label: d.label })} title={keys.length ? t('settings.keyboard.another') : undefined} onClick={() => start(d.id, keys.length)}>
                {keys.length ? <Icon name="plus" size={11} /> : t('settings.keyboard.add')}
              </button>
            ) : null}
            <button type="button" className={cx(k.reset, !isChangedRow && k.hidden)} tabIndex={isChangedRow ? 0 : -1} aria-label={t('settings.keyboard.resetAria', { label: d.label })} title={t('settings.keyboard.backTo', { keys: d.keys.map(chordLabel).join(', ') || t('settings.common.none') })} onClick={() => reset(d.id)}>
              <Icon name="refresh" size={11} />
            </button>
          </div>
        </div>
        {clash?.id === d.id ? (
          <div id="kb-clash" className={k.clash} role="alert">
            <Icon name="info" size={13} className={k.clashIcon} />
            <span className={k.clashText}>
              <kbd className={k.inline}>{chordLabel(clash.chord)}</kbd>
              {t('settings.keyboard.clashIs')}
              {clash.others.map((o, i) => (
                <span key={o}>
                  {i ? t('settings.layout.and') : ''}
                  <button type="button" className={k.link} onClick={() => reveal(o)}>
                    {shortcutDef(o)?.label ?? o}
                  </button>
                </span>
              ))}
              {/* "Pull Request…" ends its own sentence. */}
              {shortcutDef(clash.others[clash.others.length - 1]!)?.label.endsWith('…') ? t('settings.keyboard.clashEndEllipsis') : t('settings.keyboard.clashEnd')}
              {clash.slot < keys.length ? t('settings.keyboard.swapOrTake') : t('settings.keyboard.take')}
            </span>
            {clash.slot < keys.length ? (
              <Button size="small" onClick={() => commit(clash.id, clash.slot, clash.chord, 'swap', clash.others)}>
                {t('settings.keyboard.swap')}
              </Button>
            ) : null}
            <Button size="small" variant="primary" onClick={() => commit(clash.id, clash.slot, clash.chord, 'replace', clash.others)}>
              {t('settings.keyboard.useHere')}
            </Button>
            <Button size="small" variant="quiet" onClick={() => setClash(undefined)}>
              {t('settings.common.cancel')}
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <div className={k.bar}>
        <div className={cx(k.search, byKeys && k.searchOn)}>
          <Icon name="search" size={13} />
          {keyQuery ? (
            <span className={k.queryChip}>
              {chordLabel(keyQuery)}
              <button type="button" aria-label={t('settings.keyboard.showEvery')} onClick={() => setKeyQuery(undefined)}>
                <Icon name="x" size={8} />
              </button>
            </span>
          ) : null}
          {byKeys ? (
            <span className={k.searchHint}>{held ? `${held}…` : t('settings.keyboard.pressToFind')}</span>
          ) : (
            <input
              className={k.searchInput}
              value={query}
              placeholder={keyQuery ? '' : t('settings.keyboard.search')}
              aria-label={t('settings.keyboard.search')}
              onChange={(e) => {
                setKeyQuery(undefined);
                setQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && (query || keyQuery)) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                  setKeyQuery(undefined);
                } else if (e.key === 'Backspace' && !query && keyQuery) setKeyQuery(undefined);
              }}
            />
          )}
          <button type="button" className={cx(k.byKeys, byKeys && k.byKeysOn)} aria-pressed={byKeys} title={t('settings.keyboard.findByKeys')} aria-label={t('settings.keyboard.findByKeys')} onClick={() => (stop(), setClash(undefined), setHeld(''), setByKeys((v) => !v))}>
            <Icon name="command" size={12} />
          </button>
        </div>
        <span className={k.count}>{changed.length ? t('settings.keyboard.changed', { n: changed.length }) : null}</span>
        <Button size="small" variant="quiet" icon="refresh" disabled={!changed.length} onClick={resetAll}>
          {t('settings.keyboard.resetAll')}
        </Button>
      </div>

      {keyQuery && !shown.length ? (
        <div className={k.free}>
          {builtIn ? (
            <>
              <kbd className={k.inline}>{chordLabel(keyQuery)}</kbd>
              {t('settings.keyboard.builtIn', { what: builtIn, os: osName() })}
            </>
          ) : (
            <>
              {t('settings.keyboard.freeBefore')}
              <kbd className={k.inline}>{chordLabel(keyQuery)}</kbd>
              {t('settings.keyboard.freeAfter')}
            </>
          )}
        </div>
      ) : null}
      {!keyQuery && !shown.length && !builtInRows.length ? <div className={k.free}>{t('settings.keyboard.noneCalled')}</div> : null}

      {shown.map(([section, list]) => (
        <Group key={section} title={sectionLabel(section)}>
          {list.map(row)}
        </Group>
      ))}

      {builtInRows.length ? (
        <Group title={t('settings.keyboard.builtInto', { os: osName() })}>
          {builtInRows.map(([chord, label]) => (
            <div key={chord} className={cx(s.row, k.row)}>
              <div className={s.rowText}>
                <div className={s.rowLabel}>{label}</div>
              </div>
              <div className={k.keys}>
                <span className={cx(k.chip, k.fixed)}>{chordLabel(chord)}</span>
              </div>
            </div>
          ))}
          {!keyQuery && (!query.trim() || 'send message'.includes(query.trim().toLowerCase())) ? (
            <div className={cx(s.row, k.row)}>
              <div className={s.rowText}>
                <div className={s.rowLabel}>{t('settings.keyboard.send')}</div>
                <div className={s.rowDetail}>{t('settings.keyboard.newLine', { keys: chordLabel(prefs.sendWith === 'enter' ? 'Shift+Enter' : 'Enter') })}</div>
              </div>
              <div className={k.keys}>
                <span className={cx(k.chip, k.fixed)}>{chordLabel(prefs.sendWith === 'enter' ? 'Enter' : 'Cmd+Enter')}</span>
                <Button size="small" variant="quiet" onClick={() => ui.patch({ settings: 'general' })}>
                  {t('settings.keyboard.change')}
                </Button>
              </div>
            </div>
          ) : null}
        </Group>
      ) : null}
    </>
  );
}
