import { EarningsTipBody } from '../../components/EarningsPill.js';
import { Icon } from '../../components/Icon.js';
import { ProjectIcon } from '../../components/ProjectIcon.js';
import { Button, IconButton, Tip, cx } from '../../components/ui.js';
import { type ConnectedProject, formatGlance, formatMoney, missingNote, openEarnings, ratesWhen, updatedAgo, useConvertedEarnings } from '../../lib/earnings.js';
import type { ConvertedRow } from '../../lib/money.js';
import { Card } from './parts.js';
import s from './usage.module.css';
import { t as tNow, useT } from '../../i18n/index.js';

/** One connected project: its name, what it earned in the shown currency, and a thin bar for its part of the total. */
function EarningsRow({ row, currency }: { row: ConvertedRow<ConnectedProject>; currency: string }) {
  const t = useT();
  const { project, earnings } = row.item;
  const counted = Boolean(earnings.totals);
  const nothingConverts = counted && row.money.missing.length > 0 && row.money.missing.length === earnings.totals!.length;
  const amount = !counted ? t('views.earningsCard.countingTile') : nothingConverts ? '—' : formatGlance(row.money.amount, currency);
  const pct = Math.round(row.share * 100);
  return (
    <li>
      <Tip label={<EarningsTipBody earnings={earnings} />}>
        <button type="button" className={cx(s.earnRow, earnings.refreshing && s.earnCounting)} onClick={() => openEarnings(project.id)} aria-label={`${project.name}: ${counted ? formatMoney(row.money.amount, currency) : t('views.earningsSum.counting')}${counted && pct ? t('views.earningsSum.ofTotal', { pct }) : ''}`}>
          <span className={s.earnName}>
            <ProjectIcon id={project.id} name={project.name} size={14} />
            <span className={s.earnLabel}>{project.name}</span>
            {earnings.mode === 'test' && !earnings.revenuecat ? <span className={s.earnTest}>{t('views.earningsCard.test')}</span> : null}
            {earnings.error ? <Icon name="alert" size={11} className={s.alertWarn} /> : null}
          </span>
          <span className={s.earnAmount}>{amount}</span>
          <span className={s.earnShare} aria-hidden="true">
            <span style={{ width: `${row.share > 0 ? Math.max(1.5, row.share * 100) : 0}%` }} />
          </span>
        </button>
      </Tip>
    </li>
  );
}

/**
 * The Usage view's third card: what every project with Stripe or RevenueCat connected earned, all-time, as one
 * amount in the currency you show earnings in (Settings › General, or a project's Earnings sheet),
 * then each project with its part of it. Other currencies are converted at the ECB's daily rates;
 * a project's own currencies show on hover. With none connected, a quiet way to connect one.
 */
export function EarningsSummaryCard() {
  const t = useT();
  const summary = useConvertedEarnings();
  if (!summary.projects.length) {
    return (
      <Card label={t('views.earnings.title')} title={t('views.earnings.title')} className={s.earnCard}>
        <p className={s.quiet}>{t('views.earningsSum.connectDetail')}</p>
        <div className={s.earnConnect}>
          <Button size="small" icon="coin" onClick={() => openEarnings()}>
            {t('views.earningsSum.connect')}
          </Button>
        </div>
      </Card>
    );
  }
  const { converted, fx } = summary;
  const { currency, total } = converted;
  const counted = summary.projects.some((c) => c.earnings.totals);
  const status = summary.refreshing ? t('views.earningsCard.countingTile') : summary.updatedAt ? t('views.earningsSum.updated', { ago: updatedAgo(summary.updatedAt) }) : undefined;
  const count = summary.projects.length;
  const caption = [t('views.earnings.allTime'), t('views.earningsSum.projects', { n: count }), ...(total.converted && fx ? [t('views.earningsSum.rates', { when: ratesWhen(fx.at) })] : [])].join(' · ');
  const note = missingNote(total.missing);
  return (
    <Card
      label={t('views.earnings.title')}
      title={t('views.earnings.title')}
      className={s.earnCard}
      aside={
        <>
          {status ? <span className={s.updated}>{status}</span> : null}
          <IconButton icon="plus" label={t('views.earningsSum.another')} className={s.earnAdd} onClick={() => openEarnings()} />
        </>
      }
    >
      <div className={s.earnBody}>
        <div className={s.earnSummary}>
          <Tip label={total.converted ? t('views.earningsSum.approx', { money: formatMoney(total.amount, currency) }) : formatMoney(total.amount, currency)}>
            <span className={s.earnTotal} data-earnings-total={currency} aria-label={t(total.converted ? 'views.earningsSum.totalAboutAria' : 'views.earningsSum.totalAria', { money: formatMoney(total.amount, currency) })}>
              {counted ? formatGlance(total.amount, currency) : '—'}
            </span>
          </Tip>
          <div className={s.earnCaption}>{caption}</div>
          {note ? <div className={s.earnNote}>{note}</div> : null}
        </div>
        <ul className={s.earnList} aria-label={t('views.earningsSum.byProject')}>
          {converted.rows.map((row) => (
            <EarningsRow key={row.item.project.id} row={row} currency={currency} />
          ))}
        </ul>
      </div>
    </Card>
  );
}
