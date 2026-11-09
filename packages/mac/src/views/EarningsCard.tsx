import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { Button, IconButton, Tip, cx } from '../components/ui.js';
import { EarningsTipBody } from '../components/EarningsPill.js';
import { dismissEarningsHint, formatMoney, missingNote, openStripe, updatedAgo, useConvertedEarnings, useEarningsHintDismissed } from '../lib/earnings.js';
import { useApi, useApp } from '../lib/beluga.js';
import s from './earnings-card.module.css';
import { useT } from '../i18n/index.js';

/**
 * The Overview's Earnings: every project with Stripe connected and what it earned, all-time.
 * Before any is connected, a one-time hint says it exists (dismissed for good with ✕).
 */
export function EarningsCard() {
  const api = useApi();
  const t = useT();
  const summary = useConvertedEarnings();
  const dismissed = useEarningsHintDismissed();
  const repos = useApp((st) => st.projects.filter((p) => p.root).length);
  if (!summary.projects.length) {
    if (dismissed || !repos) return null;
    return (
      <section className={s.hint} aria-label={t('views.earningsCard.trackAria')}>
        <span className={s.hintIcon} aria-hidden="true">
          <Icon name="coin" size={16} />
        </span>
        <span className={s.hintText}>
          <span className={s.hintTitle}>{t('views.earningsCard.trackTitle')}</span>
          <span className={s.hintDetail}>{t('views.earningsCard.trackDetail')}</span>
        </span>
        <Button size="small" variant="primary" onClick={() => openStripe()}>
          {t('views.earningsCard.connect')}
        </Button>
        <IconButton icon="x" label={t('views.earningsCard.dontShow')} className={s.dismiss} onClick={dismissEarningsHint} />
      </section>
    );
  }
  const { currency, total, rows } = summary.converted;
  const several = summary.projects.length > 1;
  const counted = summary.projects.some((c) => c.earnings.totals);
  return (
    <section className={s.card} aria-label={t('views.earnings.title')}>
      <div className={s.head}>
        <h2 className={s.title}>{t('views.earnings.title')}</h2>
        <span className={s.sub}>{t('views.earningsCard.allTime')}{summary.updatedAt && !summary.refreshing ? ` · ${t('views.earnings.updated', { ago: updatedAgo(summary.updatedAt) })}` : summary.refreshing ? t('views.earningsCard.counting') : ''}</span>
        <span className={s.actions}>
          <Button size="small" variant="quiet" icon="plus" onClick={() => openStripe()}>
            {t('views.earningsCard.another')}
          </Button>
          <Tip label={t('views.earningsCard.countAgain')}>
            <Button size="small" variant="quiet" icon="refresh" aria-label={t('views.earningsCard.refreshAll')} disabled={summary.refreshing} onClick={() => void api.stripe.refresh()} />
          </Tip>
        </span>
      </div>
      <div className={s.tiles}>
        {several && counted ? (
          <div className={cx(s.tile, s.all)}>
            <span className={s.tileName}>{t('views.earningsCard.allProjects')}</span>
            <span className={s.amount}>{formatMoney(total.amount, currency)}</span>
            <span className={s.others}>{missingNote(total.missing) ?? (total.converted ? t('views.earningsCard.converted') : ' ')}</span>
          </div>
        ) : null}
        {rows.map(({ item: { project, earnings }, money, share }) => (
          <Tip key={project.id} label={<EarningsTipBody earnings={earnings} />}>
            <button type="button" className={cx(s.tile, earnings.refreshing && s.counting)} onClick={() => openStripe(project.id)}>
              <span className={s.tileName}>
                <ProjectIcon id={project.id} name={project.name} size={14} />
                {project.name}
                {earnings.mode === 'test' ? <span className={s.test}>{t('views.earningsCard.test')}</span> : null}
                {earnings.error ? <Icon name="alert" size={11} className={s.warn} /> : null}
              </span>
              <span className={s.amount}>{earnings.totals ? formatMoney(money.amount, currency) : t('views.earningsCard.countingTile')}</span>
              <span className={s.others}>{missingNote(money.missing) ?? (several && earnings.totals ? t('views.earningsCard.share', { pct: Math.round(share * 100) }) : ' ')}</span>
            </button>
          </Tip>
        ))}
      </div>
    </section>
  );
}
