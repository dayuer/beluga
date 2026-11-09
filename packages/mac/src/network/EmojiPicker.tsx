import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon.js';
import { type EmojiCategory, type PickerEmoji, loadEmojiCategories, searchEmojis } from './emoji-data.js';
import r from './reactions.module.css';
import { type Key, useT } from '../i18n/index.js';

/** Each category's name in the language shown (emoji-data keeps Unicode's English). */
const CATEGORY: Readonly<Record<string, Key>> = {
  smileys: 'network.emoji.smileys',
  people: 'network.emoji.people',
  nature: 'network.emoji.nature',
  food: 'network.emoji.food',
  travel: 'network.emoji.travel',
  activities: 'network.emoji.activities',
  objects: 'network.emoji.objects',
  symbols: 'network.emoji.symbols',
  flags: 'network.emoji.flags',
};

/**
 * Every emoji, to react with one (BLG-702): a search field, the categories as icons to jump to,
 * and the grid; what's under the pointer is named at the bottom. Your quick row comes first, as
 * Recent. Return picks the first search result, Esc closes (the popover's own).
 */
export function EmojiPicker({ recent, onPick }: { recent: readonly string[]; onPick: (emoji: string) => void }) {
  const t = useT();
  const [categories, setCategories] = useState<readonly EmojiCategory[] | undefined>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<PickerEmoji | undefined>();
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    loadEmojiCategories().then(
      (c) => alive && setCategories(c),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  const byEmoji = useMemo(() => new Map((categories ?? []).flatMap((c) => c.emojis.map((e) => [e.emoji, e] as const))), [categories]);
  const sections = useMemo<readonly EmojiCategory[]>(() => {
    if (!categories) return [];
    const found = searchEmojis(categories, query);
    if (query.trim()) return [{ key: 'found', label: found.length ? t('network.emoji.results') : t('network.emoji.noMatch'), icon: 'search', emojis: found }];
    const mine = recent.map((e) => byEmoji.get(e) ?? { emoji: e, label: e, words: '' });
    return [{ key: 'recent', label: t('network.emoji.recent'), icon: 'clock', emojis: mine }, ...categories.map((c) => (CATEGORY[c.key] ? { ...c, label: t(CATEGORY[c.key]!) } : c))];
  }, [categories, query, recent, byEmoji, t]);

  const jump = (key: string): void => {
    setQuery('');
    requestAnimationFrame(() => grid.current?.querySelector(`[data-section="${key}"]`)?.scrollIntoView({ block: 'start' }));
  };

  return (
    <div className={r.picker}>
      <div className={r.pickerSearch}>
        <Icon name="search" size={13} />
        <input
          autoFocus
          value={query}
          placeholder={t('network.emoji.search')}
          aria-label={t('network.emoji.search')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const first = sections[0]?.emojis[0];
            if (e.key === 'Enter' && query.trim() && first) {
              e.preventDefault();
              onPick(first.emoji);
            }
          }}
        />
      </div>
      {query.trim() ? null : (
        <div className={r.pickerTabs} role="tablist" aria-label={t('network.emoji.categories')}>
          {sections.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={false} className={r.pickerTab} title={c.label} aria-label={c.label} onClick={() => jump(c.key)}>
              <Icon name={c.icon} size={14} />
            </button>
          ))}
        </div>
      )}
      <div ref={grid} className={r.pickerGrid} onMouseLeave={() => setHover(undefined)}>
        {failed ? <div className={r.pickerNote}>{t('network.emoji.couldntLoad')}</div> : !categories ? <div className={r.pickerNote}>{t('network.emoji.loading')}</div> : null}
        {sections.map((c) => (
          <section key={c.key} data-section={c.key} className={r.pickerSection}>
            <div className={r.pickerHead}>{c.label}</div>
            <div className={r.pickerCells}>
              {c.emojis.map((e) => (
                <button key={e.emoji} type="button" className={r.pickerCell} aria-label={e.label} onMouseEnter={() => setHover(e)} onFocus={() => setHover(e)} onClick={() => onPick(e.emoji)}>
                  {e.emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className={r.pickerFoot} aria-live="polite">
        {hover ? (
          <>
            <span className={r.pickerFootEmoji}>{hover.emoji}</span>
            <span className={r.pickerFootName}>{hover.label}</span>
          </>
        ) : (
          <span className={r.pickerFootHint}>{t('network.emoji.pick')}</span>
        )}
      </div>
    </div>
  );
}
