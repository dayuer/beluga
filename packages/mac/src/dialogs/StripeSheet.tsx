import { useState } from 'react';
import type { ProjectEarnings } from '@beluga/core/earnings-store.js';
import type { Project } from '@beluga/workspaces/types.js';
import { stripeKeyKind, stripeKeyProblem } from '@beluga/shared/stripe-keys.js';
import { Alert } from '../components/Alert.js';
import { Field, FormSheet, Popup, TextInput, formStyles as f } from '../components/FormSheet.js';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { rangeFigures } from '@beluga/core/earnings-store.js';
import { STRIPE_KEY_URL, closeStripe, formatMoney, missingNote, updatedAgo, useConverted, useProjectEarnings, useStripeSheet } from '../lib/earnings.js';
import { CurrencySelect } from './EarningsSettings.js';
import { brandText } from '../lib/brand.js';
import { useApi, useApp } from '../lib/beluga.js';
import { openExternal } from '../lib/system.js';
import s from './stripe.module.css';
import { thisComputer } from '../lib/os-words.js';
import { rich } from './native/pick.js';
import { useT } from '../i18n/index.js';

/**
 * Connect Stripe to a project and see what it earned: a key field (masked, paste-aware, live
 * or test said right away), where to make a key that can only read charges, and once
 * connected the account, the totals, Refresh, Replace Key and Disconnect.
 */
export function StripeSheet() {
  const sheet = useStripeSheet();
  if (!sheet) return null;
  return <StripeSheetBody key={sheet.projectId ?? 'pick'} initial={sheet.projectId} />;
}

function StripeSheetBody({ initial }: { initial: string | undefined }) {
  const t = useT();
  const all = useApp((st) => st.projects);
  const earnings = useApp((st) => st.earnings);
  const projects = all.filter((p) => p.root);
  const [projectId, setProjectId] = useState(() => initial ?? projects.find((p) => !earnings[p.root])?.id ?? projects[0]?.id);
  const [replacing, setReplacing] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  const connected = useProjectEarnings(project?.root);
  if (!project) {
    return <FormSheet title={t('dialogs.stripe.connect')} icon="coin" intro={t('dialogs.stripe.noProject')} submitLabel={t('dialogs.stripe.done')} hideSubmit onSubmit={() => undefined} onCancel={closeStripe} />;
  }
  if (connected && !replacing) return <Connected project={project} earnings={connected} onReplace={() => setReplacing(true)} />;
  return <ConnectForm project={project} projects={initial ? undefined : projects} onProject={setProjectId} replacing={Boolean(connected)} onBack={connected ? () => setReplacing(false) : undefined} />;
}

function ConnectForm({ project, projects, onProject, replacing, onBack }: { project: Project; projects: readonly Project[] | undefined; onProject: (id: string) => void; replacing: boolean; onBack: (() => void) | undefined }) {
  const t = useT();
  const api = useApi();
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [pasted, setPasted] = useState(false);
  const [touched, setTouched] = useState(false);
  const trimmed = key.trim();
  const problem = trimmed ? stripeKeyProblem(trimmed) : undefined;
  const kind = stripeKeyKind(trimmed);
  const showProblem = problem && (touched || pasted);
  return (
    <FormSheet
      title={replacing ? t('dialogs.stripe.replaceTitle', { name: project.name }) : t('dialogs.stripe.connectTo', { name: project.name })}
      icon="coin"
      intro={
        <p>{t('dialogs.stripe.intro', { name: project.name, computer: thisComputer() })}</p>
      }
      submitLabel={t('dialogs.stripe.connectButton')}
      canSubmit={Boolean(trimmed) && !problem}
      onCancel={onBack ?? closeStripe}
      cancelLabel={onBack ? t('dialogs.stripe.back') : t('dialogs.stripe.cancel')}
      width={560}
      onSubmit={async () => {
        const result = await api.stripe.connect(project.id, trimmed);
        if (!result.ok) return result.error;
        setKey('');
        onBack?.();
        return undefined;
      }}
    >
      {projects && projects.length > 1 ? (
        <Field label={t('dialogs.stripe.project')} htmlFor="stripe-project">
          <Popup id="stripe-project" label={t('dialogs.stripe.project')} value={project.id} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={onProject} />
        </Field>
      ) : null}
      <Field
        label={t('dialogs.stripe.restricted')}
        htmlFor="stripe-key"
        error={showProblem ? problem : undefined}
        hint={
          kind.secret && !problem ? (
            <span className={s.caution}>
              <Icon name="alert" size={11} />
              {t('dialogs.stripe.fullSecret')}
            </span>
          ) : pasted && !problem ? (
            t('dialogs.stripe.pasted')
          ) : (
            t('dialogs.stripe.startsWith')
          )
        }
        aside={
          <>
            {kind.mode && !problem ? <ModeBadge mode={kind.mode} /> : null}
            <button type="button" className={s.reveal} aria-label={reveal ? t('dialogs.stripe.hideKey') : t('dialogs.stripe.showKey')} aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
              <Icon name="eye" size={13} />
            </button>
          </>
        }
      >
        <TextInput
          id="stripe-key"
          type={reveal ? 'text' : 'password'}
          mono
          placeholder="rk_live_…"
          value={key}
          invalid={Boolean(showProblem)}
          onChange={(v) => {
            setKey(v);
            setPasted(false);
          }}
          onBlur={() => setTouched(true)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').trim();
            if (!text) return;
            e.preventDefault();
            setKey(text);
            setPasted(true);
          }}
          data-autofocus
          autoCapitalize="off"
          autoCorrect="off"
        />
      </Field>
      <div className={s.howto}>
        <div className={s.howtoHead}>
          <span>{t('dialogs.stripe.noneYet')}</span>
          <button type="button" className={f.linkButton} onClick={() => void openExternal(STRIPE_KEY_URL)}>
            {t('dialogs.stripe.create')}
            <Icon name="forward" size={10} />
          </button>
        </div>
        <ol className={s.steps}>
          <li>{rich(t('dialogs.stripe.step1'), { charges: <b>Charges</b>, read: <b>Read</b> })}</li>
          <li>{rich(t('dialogs.stripe.step2'), { accounts: <b>Accounts</b>, read: <b>Read</b> })}</li>
          <li>{t('dialogs.stripe.step3')}</li>
        </ol>
        <div className={s.counted}>{t('dialogs.stripe.counted')}</div>
      </div>
    </FormSheet>
  );
}

function ModeBadge({ mode }: { mode: 'live' | 'test' }) {
  const t = useT();
  return <span className={cx(s.badge, mode === 'live' ? s.live : s.testMode)}>{mode === 'live' ? t('dialogs.stripe.live') : t('dialogs.stripe.test')}</span>;
}

function Connected({ project, earnings, onReplace }: { project: Project; earnings: ProjectEarnings; onReplace: () => void }) {
  const t = useT();
  const api = useApi();
  const [confirm, setConfirm] = useState(false);
  const totals = earnings.totals ?? [];
  const money = useConverted(totals);
  const breakdown = money.converted || money.missing.length > 0;
  const note = missingNote(money.missing);
  const needsKey = earnings.error?.code === 'revoked' || earnings.error?.code === 'permission';
  const month = earnings.activity ? rangeFigures(earnings.activity, 30) : undefined;
  const monthMoney = useConverted(month?.totals);
  if (confirm) {
    return (
      <Alert
        title={t('dialogs.stripe.disconnectTitle', { name: project.name })}
        message={t('dialogs.stripe.disconnectMessage')}
        tone="danger"
        confirm={{
          label: t('dialogs.stripe.disconnect'),
          destructive: true,
          onClick: () => {
            void api.stripe.disconnect(project.id);
            closeStripe();
          },
        }}
        onCancel={() => setConfirm(false)}
      />
    );
  }
  return (
    <FormSheet
      title={t('dialogs.stripe.earnings', { name: project.name })}
      icon="coin"
      intro={
        <span className={s.account}>
          {earnings.account ?? t('dialogs.stripe.yourAccount')}
          <ModeBadge mode={earnings.mode} />
        </span>
      }
      submitLabel={t('dialogs.stripe.done')}
      hideSubmit
      cancelLabel={t('dialogs.stripe.done')}
      width={480}
      onSubmit={() => undefined}
      onCancel={closeStripe}
      footer={
        <>
          <button type="button" className={f.linkDanger} onClick={() => setConfirm(true)}>
            {t('dialogs.stripe.disconnectMore')}
          </button>
          <button type="button" className={f.linkButton} onClick={onReplace}>
            {t('dialogs.stripe.replaceKey')}
          </button>
        </>
      }
    >
      <div className={cx(s.total, earnings.refreshing && s.counting)} aria-live="polite">
        <span className={s.totalLabel}>{t('dialogs.stripe.allTime')}</span>
        <span className={s.totalValue}>{earnings.totals ? `${money.converted ? '≈ ' : ''}${formatMoney(money.amount, money.currency)}` : t('dialogs.stripe.counting')}</span>
        {breakdown ? (
          <span className={s.others}>
            <span className={s.othersLabel}>{t('dialogs.stripe.inStripe')}</span>
            {totals.map((x) => (
              <span key={x.currency}>{formatMoney(x.amount, x.currency)}</span>
            ))}
          </span>
        ) : null}
        {note ? <span className={s.note}>{note}</span> : null}
        {month ? (
          <span className={s.lately} data-last-30>
            {t('dialogs.stripe.last30', { approx: monthMoney.converted ? '≈ ' : '', money: formatMoney(monthMoney.amount, monthMoney.currency), n: month.payments, payers: month.payers ?? '' })}
          </span>
        ) : null}
        <span className={s.meta}>
          {earnings.refreshing ? t('dialogs.stripe.counting') : t('dialogs.stripe.updated', { when: updatedAgo(earnings.updatedAt) })}
          <button type="button" className={f.linkButton} disabled={earnings.refreshing} onClick={() => void api.stripe.refresh(project.id)}>
            {t('dialogs.stripe.refresh')}
          </button>
        </span>
      </div>
      <Field label={t('dialogs.stripe.currency')} htmlFor="stripe-currency" hint={t('dialogs.stripe.currencyHint')}>
        <CurrencySelect id="stripe-currency" className={f.popup} />
      </Field>
      {earnings.error ? (
        <div className={s.problem} role="status">
          <Icon name="alert" size={13} />
          <span>{brandText(earnings.error.message)}</span>
          {needsKey ? (
            <button type="button" className={f.linkButton} onClick={onReplace}>
              {t('dialogs.stripe.newKey')}
            </button>
          ) : null}
        </div>
      ) : null}
      {earnings.secretKey ? (
        <div className={s.caution}>
          <Icon name="alert" size={11} />
          {t('dialogs.stripe.secretNote')}
        </div>
      ) : null}
      <div className={s.counted}>{t('dialogs.stripe.countedConnected')}</div>
    </FormSheet>
  );
}
