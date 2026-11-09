import { useRef, useState } from 'react';
import { fireVars, SETUPS, setupOf, DEFAULT_FIRE, type FireLook, type FirePalette, PALETTES, PRESETS, paletteOf, presetOf, TIMING } from '../chat/fire-look.js';
import { MaxFire } from '../chat/MaxFire.js';
import { Icon } from '../components/Icon.js';
import { Button, Segmented, cx } from '../components/ui.js';
import { setPrefs, usePrefs } from '../lib/prefs.js';
import { Group, Row, Switch } from './settings-controls.js';
import f from './fire-settings.module.css';
import m from '../chat/max.module.css';
import s from './settings.module.css';
import { useT } from '../i18n/index.js';

/** The dials, in plain words at each end. */
const DIALS = [
  { key: 'fuel', label: 'settings.fire.fuel', low: 'settings.fire.fuelLow', high: 'settings.fire.fuelHigh' },
  { key: 'height', label: 'settings.fire.height', low: 'settings.fire.heightLow', high: 'settings.fire.heightHigh' },
  { key: 'thickness', label: 'settings.fire.thickness', low: 'settings.fire.thicknessLow', high: 'settings.fire.thicknessHigh' },
  { key: 'wildness', label: 'settings.fire.wildness', low: 'settings.fire.wildnessLow', high: 'settings.fire.wildnessHigh' },
] as const;

/** Only while typing: how soon it catches and goes out (and the seconds it is). */
const TIMES = [
  { key: 'catchAfter', label: 'settings.fire.catches', low: 'settings.fire.atOnce', high: 'settings.fire.afterAWhile' },
  { key: 'outAfter', label: 'settings.fire.goesOut', low: 'settings.fire.atOnce', high: 'settings.fire.lingers' },
] as const;

/** A slider with a word at each end, its track filled in the fire's colours (and, `shown`, its value at the end). */
export function Dial({ label, low, high, value, min = 0, max = 1, step = 0.05, colors, shown, onChange }: { label: string; low: string; high: string; value: number; min?: number; max?: number; step?: number; colors: readonly string[]; shown?: string; onChange: (v: number) => void }) {
  return (
    <div className={cx(f.dial, shown !== undefined && f.shown)}>
      <span className={f.dialLabel}>{label}</span>
      <span className={f.end}>{low}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        className={f.range}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%`, '--c0': colors[0], '--c1': colors[1] } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={f.end}>{high}</span>
      {shown !== undefined ? <span className={f.value}>{shown}</span> : null}
    </div>
  );
}

/** Three dots in a palette's colours, edge to core. */
function Dots({ colors }: { colors: readonly string[] }) {
  return (
    <span className={f.dots}>
      {colors.map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

/** A little flame in a palette's colours (the presets' and palettes' picture). */
function Swatch({ colors }: { colors: readonly string[] }) {
  return (
    <svg className={f.swatch} viewBox="0 0 24 30" aria-hidden>
      <path d="M12 1C14 8 22 12 22 20a10 10 0 0 1-20 0C2 14 7 11 8 5c2 3 3 5 3 7 2-3 2-7 1-11z" fill={colors[0]} />
      <path d="M12 9c1 4 6 7 6 12a6 6 0 0 1-12 0c0-3 2-5 3-8 1 2 1 3 1 4 2-2 2-5 2-8z" fill={colors[1]} />
      <path d="M12 17c1 2 3 3 3 5a3 3 0 0 1-6 0c0-2 2-3 3-5z" fill={colors[2]} />
    </svg>
  );
}

/**
 * Settings › Fire & Confetti: the message box's effects (on Max effort by default, or everywhere). A preset sets everything; the
 * sliders, colours and switches fine-tune it. The preview at the top burns as you change it: type
 * or delete there to try it.
 */
export function FireSettings() {
  const look = usePrefs().maxFire;
  const t = useT();
  const set = (patch: Partial<FireLook>): void => {
    const next = { ...look, ...patch };
    setPrefs({ maxFire: { ...next, preset: presetOf(next) } });
  };
  const colors = paletteOf(look).colors;
  return (
    <>
      <Preview look={look} />
      <Group title={t('settings.fire.whatsOn')}>
        <div className={f.presets} role="radiogroup" aria-label={t('settings.fire.whatsOn')}>
          {SETUPS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={setupOf(look) === x.id} className={cx(f.preset, setupOf(look) === x.id && f.on)} onClick={() => set(x.set)}>
              <span className={f.presetName}>{x.name}</span>
              <span className={f.presetBlurb}>{x.blurb}</span>
            </button>
          ))}
        </div>
        <Row label={t('settings.fire.where')} detail={look.where === 'max' ? t('settings.fire.whereMax') : t('settings.fire.whereEverywhere')}>
          <Segmented
            label={t('settings.fire.where')}
            radio
            value={look.where}
            onChange={(where) => set({ where })}
            options={[
              { value: 'max', label: t('settings.fire.onMaxOnly') },
              { value: 'everywhere', label: t('settings.fire.everywhere') },
            ]}
          />
        </Row>
      </Group>
      <Group title={t('settings.common.startFrom')}>
        <div className={f.presets} role="radiogroup" aria-label={t('settings.fire.presets')}>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={look.preset === p.id} className={cx(f.preset, look.preset === p.id && f.on)} onClick={() => set(p.look)}>
              <Swatch colors={paletteOf({ palette: p.look.palette, palettes: look.palettes }).colors} />
              <span className={f.presetName}>{p.name}</span>
              <span className={f.presetBlurb}>{p.blurb}</span>
            </button>
          ))}
          {look.preset === 'custom' ? (
            <div className={cx(f.preset, f.on)} role="radio" aria-checked>
              <Swatch colors={colors} />
              <span className={f.presetName}>{t('settings.common.yourOwn')}</span>
              <span className={f.presetBlurb}>{t('settings.common.tunedByYou')}</span>
            </div>
          ) : null}
        </div>
      </Group>
      <Group title={t('settings.fire.whenHow')}>
        <Row label={t('settings.fire.whenBurns')}>
          <Segmented
            label={t('settings.fire.whenBurns')}
            radio
            value={look.show}
            onChange={(show) => set({ show })}
            options={[
              { value: 'always', label: t('settings.common.always') },
              { value: 'typing', label: t('settings.fire.whileTypingOption') },
              { value: 'off', label: t('settings.common.never') },
            ]}
          />
        </Row>
        <Row label={t('settings.fire.colorBox')} detail={look.border ? t('settings.fire.colorBoxOn') : t('settings.fire.colorBoxOff')}>
          <Switch label={t('settings.fire.colorBox')} on={look.border} onChange={(border) => set({ border })} />
        </Row>
        <Row label={t('settings.fire.style')}>
          <Segmented
            label={t('settings.fire.style')}
            radio
            value={look.style}
            onChange={(style) => set({ style })}
            options={[
              { value: 'toon', label: t('settings.fire.flame') },
              { value: 'pixel', label: t('settings.fire.pixelArt') },
            ]}
          />
        </Row>
      </Group>
      {look.show === 'typing' ? (
        <Group title={t('settings.fire.whileTyping')}>
          {TIMES.map((d) => (
            <Dial key={d.key} label={t(d.label)} low={t(d.low)} high={t(d.high)} {...TIMING[d.key]} value={look[d.key]} colors={colors} shown={`${Number(look[d.key].toFixed(1))} s`} onChange={(v) => set({ [d.key]: v })} />
          ))}
        </Group>
      ) : null}
      <Group title={t('settings.fire.flames')}>
        {DIALS.map((d) => (
          <Dial key={d.key} label={t(d.label)} low={t(d.low)} high={t(d.high)} value={look[d.key]} colors={colors} onChange={(v) => set({ [d.key]: v })} />
        ))}
      </Group>
      <Colors look={look} set={set} />
      <Group title={t('settings.fire.extras')}>
        <Row label={t('settings.fire.flare')} detail={t('settings.fire.flareDetail')}>
          <Switch label={t('settings.fire.flare')} on={look.temper} onChange={(temper) => set({ temper })} />
        </Row>
        <Row label={t('settings.fire.asYouType')} detail={t('settings.fire.asYouTypeDetail')}>
          <Segmented
            label={t('settings.fire.asYouType')}
            radio
            value={look.typing}
            onChange={(typing) => set({ typing })}
            options={[
              { value: 'off', label: t('settings.fire.nothing') },
              { value: 'confetti', label: t('settings.fire.confetti') },
              { value: 'pixels', label: t('settings.fire.pixels') },
            ]}
          />
        </Row>
        <Row label={t('settings.fire.popDelete')} detail={t('settings.fire.popDeleteDetail')}>
          <Switch label={t('settings.fire.popDelete')} on={look.popDelete} onChange={(popDelete) => set({ popDelete })} />
        </Row>
      </Group>
      {(['preset', 'show', 'where', 'typing', 'popDelete', 'catchAfter', 'outAfter'] as const).some((k) => look[k] !== DEFAULT_FIRE[k]) ? (
        <div className={f.reset}>
          <Button size="small" onClick={() => setPrefs({ maxFire: { ...DEFAULT_FIRE, palettes: look.palettes } })}>
            {t('settings.common.backToDefault')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** A box like the message box, burning with these settings: type or delete in it to try them (`className` replaces the stage's own look; the welcome's Fire step has its own). */
export function Preview({ look, className }: { look: FireLook; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const t = useT();
  // As it will be: no flames when the fire is off (the pixels and confetti still fly).
  return (
    <div className={className ?? f.stage} style={{ paddingTop: 200 }}>
      <div ref={box} data-fire={look.show} className={cx(f.fakeBox, look.show !== 'off' && look.border ? m.max : cx(f.plainBox, m.maxPlain))} style={fireVars(look) as React.CSSProperties}>
        <MaxFire box={box} input={input} look={look} />
        <textarea ref={input} className={f.fakeInput} rows={2} value={text} placeholder={t('settings.fire.tryPlaceholder')} aria-label={t('settings.fire.tryAria')} onChange={(e) => setText(e.target.value)} />
      </div>
    </div>
  );
}

/** The palettes: Beluga's and yours (named by you), and a maker for new ones. */
function Colors({ look, set }: { look: FireLook; set: (patch: Partial<FireLook>) => void }) {
  const [making, setMaking] = useState<FirePalette | undefined>();
  const mine = look.palettes;
  const t = useT();
  const save = (p: FirePalette): void => {
    const name = p.name.trim() || t('settings.fire.myColors');
    const palettes = mine.some((x) => x.id === p.id) ? mine.map((x) => (x.id === p.id ? { ...p, name } : x)) : [...mine, { ...p, name }];
    set({ palettes, palette: p.id });
    setMaking(undefined);
  };
  const remove = (id: string): void => {
    set({ palettes: mine.filter((x) => x.id !== id), ...(look.palette === id ? { palette: 'blue' } : {}) });
    setMaking(undefined);
  };
  return (
    <Group title={t('settings.fire.colors')}>
      <div className={f.palettes} role="radiogroup" aria-label={t('settings.fire.colorsAria')}>
        {[...PALETTES, ...mine].map((p) => {
          const own = mine.includes(p);
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={look.palette === p.id}
              className={cx(f.palette, look.palette === p.id && f.on)}
              onClick={() => set({ palette: p.id })}
              onDoubleClick={() => own && setMaking(p)}
              title={own ? t('settings.fire.doubleClick') : undefined}
            >
              <Dots colors={p.colors} />
              {p.name}
              {own && look.palette === p.id ? (
                <span
                  className={f.edit}
                  role="button"
                  tabIndex={0}
                  aria-label={t('settings.fire.change', { name: p.name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMaking(p);
                  }}
                >
                  <Icon name="pencil" size={10} />
                </span>
              ) : null}
            </button>
          );
        })}
        <button type="button" className={cx(f.palette, f.add)} onClick={() => setMaking({ id: `own-${Date.now().toString(36)}`, name: '', colors: [...paletteOf(look).colors] as [string, string, string] })}>
          <Icon name="plus" size={11} />
          {t('settings.fire.newColors')}
        </button>
      </div>
      {making ? <Maker palette={making} isNew={!mine.some((x) => x.id === making.id)} onSave={save} onCancel={() => setMaking(undefined)} onDelete={() => remove(making.id)} /> : null}
    </Group>
  );
}

/** Three round wells (edge, middle, core) and a name. */
function Maker({ palette, isNew, onSave, onCancel, onDelete }: { palette: FirePalette; isNew: boolean; onSave: (p: FirePalette) => void; onCancel: () => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(palette);
  const t = useT();
  const well = (i: 0 | 1 | 2, label: string) => (
    <label className={f.well}>
      <span className={f.wellDot} style={{ background: draft.colors[i] }}>
        <input
          type="color"
          aria-label={label}
          value={draft.colors[i]}
          onChange={(e) => {
            const colors = [...draft.colors] as [string, string, string];
            colors[i] = e.target.value;
            setDraft({ ...draft, colors });
          }}
        />
      </span>
      {label}
    </label>
  );
  return (
    <form
      className={f.maker}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <Swatch colors={draft.colors} />
      {well(0, t('settings.fire.edge'))}
      {well(1, t('settings.fire.middle'))}
      {well(2, t('settings.fire.core'))}
      <input className={cx(s.text, f.name)} placeholder={t('settings.fire.namePlaceholder')} aria-label={t('settings.localModels.name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
      <span className={f.makerButtons}>
        {isNew ? null : (
          <Button size="small" variant="quiet" onClick={onDelete}>
            {t('settings.common.delete')}
          </Button>
        )}
        <Button size="small" variant="quiet" onClick={onCancel}>
          {t('settings.common.cancel')}
        </Button>
        <Button size="small" variant="primary" type="submit">
          {isNew ? t('settings.fire.add') : t('settings.common.save')}
        </Button>
      </span>
    </form>
  );
}
