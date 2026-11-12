import { useState } from 'react';
import type { NeedsYou } from '@beluga/companion/protocol.js';
import { noticeAgo } from '@beluga/ui/notice-models.js';
import { Button } from '../components/ui.js';
import { Icon } from '../components/Icon.js';
import { t } from '../i18n/index.js';
import s from './start-gate-card.module.css';

/**
 * A Synon Studio start Gate in the bell (docs/studio-gates.md §3.7, BLG-75): a customer confirmed
 * a plan (or a change to it), and it starts only when the operator says so — on this Mac or on the
 * phone, the same answer. The card says which plan, how many milestones and points, and who asked;
 * "Decline" takes a sentence the customer reads. The answer goes to `studio.answerGate`, never to
 * a `plans.*` call.
 */

export type StartGateAnswer = { readonly approve: true } | { readonly approve: false; readonly reason?: string };
export type StartGateResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface StartGateCardProps {
  gate: NonNullable<NeedsYou['gate']>;
  /** Who asked (the customer's name, or the project while the hub doesn't send it). */
  from?: string;
  askedAt?: number;
  now?: number;
  onAnswer(answer: StartGateAnswer): Promise<StartGateResult>;
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  stale: 'The plan changed since the customer confirmed it. Ask them to confirm again.',
  settled: 'This one was already answered.',
  gone: 'This Gate is no longer here.',
};

export function StartGateCard({ gate, from, askedAt, now = Date.now(), onAnswer }: StartGateCardProps) {
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();

  const title = gate.kind === 'start' ? t(`Approve start of “${gate.plan}”?`) : t(`Approve the changes to “${gate.plan}”?`);
  const added = gate.added ?? { milestones: 0, tasks: 0, points: 0 };
  const numbers =
    gate.kind === 'start'
      ? gate.milestones === 1
        ? t(`1 milestone · ${gate.points} pts`)
        : t(`${gate.milestones} milestones · ${gate.points} pts`)
      : [
          added.milestones === 1 ? t('+1 milestone') : t(`+${added.milestones} milestones`),
          added.tasks === 1 ? t('+1 task') : t(`+${added.tasks} tasks`),
          t(`+${added.points} pts`),
        ].join(' · ');
  const meta = [from ? t(`Asked by ${from}`) : '', askedAt ? noticeAgo(askedAt, now) : ''].filter(Boolean).join(' · ');

  const answer = async (a: StartGateAnswer): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await onAnswer(a);
    setBusy(false);
    if (result.ok) return;
    const key = ERROR_KEYS[result.error];
    setError(key ? t(key) : t(`Could not answer: ${result.error}`));
  };

  return (
    <li className={s.card} data-gate={gate.kind}>
      <div className={s.head}>
        <span className={s.tile}>
          <Icon name="wand" size={14} />
        </span>
        <span className={s.text}>
          <span className={s.title}>{title}</span>
          {meta ? <span className={s.meta}>{meta}</span> : null}
        </span>
      </div>
      <div className={s.numbers}>{numbers}</div>
      {error ? <p className={s.error}>{error}</p> : null}
      {declining ? (
        <div className={s.decline}>
          <label className={s.label} htmlFor={`gate-reason-${gate.plan}`}>
            {t('Why not? The customer reads this.')}
          </label>
          <textarea
            id={`gate-reason-${gate.plan}`}
            className={s.input}
            value={reason}
            maxLength={1000}
            rows={2}
            placeholder={t('Say what to change, or leave it empty')}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className={s.buttons}>
            <Button size="small" variant="plain" disabled={busy} onClick={() => setDeclining(false)}>
              {t('Cancel')}
            </Button>
            <Button size="small" variant="primary" disabled={busy} onClick={() => void answer({ approve: false, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
              {busy ? t('Sending…') : t('Send decline')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={s.buttons}>
          <Button size="small" variant="primary" disabled={busy} onClick={() => void answer({ approve: true })}>
            {busy ? t('Sending…') : t('Approve')}
          </Button>
          <Button size="small" variant="plain" disabled={busy} onClick={() => setDeclining(true)}>
            {t('Decline')}
          </Button>
        </div>
      )}
    </li>
  );
}
