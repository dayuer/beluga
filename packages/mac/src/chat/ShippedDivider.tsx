import { memo } from 'react';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { openExternal } from '../lib/system.js';
import type { MergedItem, ShippedItem } from './merged-model.js';
import { useT } from '../i18n/index.js';
import s from './context.module.css';

/** A PR as a link to it on GitHub (or just its number). */
function PrLink({ number, url }: { number: number; url?: string }) {
  const t = useT();
  const pr = `PR #${number}`;
  if (!url) return <>{pr}</>;
  return (
    <button type="button" className={s.prLink} onClick={() => void openExternal(url)} title={t('chat.shipped.openPr', { pr })}>
      {pr}
    </button>
  );
}

/**
 * Continue After Merge: the chat above went out in a pull request that merged, and what's below
 * is new work for the next one. The PR number opens it on GitHub.
 */
export const ShippedDivider = memo(function ShippedDivider({ item }: { item: ShippedItem }) {
  const m = item.shipped;
  const t = useT();
  return (
    <div className={cx(s.divider, s.shipped)} data-shipped-divider={m.number} role="separator" aria-label={item.text}>
      <div className={s.rule}>
        <span className={s.label}>
          <Icon name="merge" size={11} />
          <span>
            {t('chat.shipped.wentTo')}
            <PrLink number={m.number} {...(m.url ? { url: m.url } : {})} />
            {t('chat.shipped.mergedInto', { into: m.into })}
          </span>
        </span>
      </div>
      <div className={s.fresh}>{t('chat.shipped.fresh')}</div>
    </div>
  );
});

/**
 * The work above merged: in Beluga, on GitHub, or into the main folder. Said as it happens, so a
 * merge done elsewhere shows in the chat too. The PR number opens it on GitHub.
 */
export const MergedDivider = memo(function MergedDivider({ item }: { item: MergedItem }) {
  const m = item.merged;
  const t = useT();
  return (
    <div className={cx(s.divider, s.shipped)} data-merged-divider={m.number ?? 'merged'} role="separator" aria-label={item.text}>
      <div className={s.rule}>
        <span className={s.label}>
          <Icon name="merge" size={11} />
          <span>
            {t('chat.shipped.wasMerged', { into: m.into })}
            {m.number !== undefined ? (
              <>
                {' '}
                {t('chat.shipped.in')}
                <PrLink number={m.number} {...(m.url ? { url: m.url } : {})} />
              </>
            ) : null}
          </span>
        </span>
      </div>
    </div>
  );
});
