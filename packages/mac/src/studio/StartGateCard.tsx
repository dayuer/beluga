import { useState } from 'react';
import type { NeedsYou } from '@beluga/companion/protocol.js';
import { noticeAgo } from '@beluga/ui/notice-models.js';
import { Button } from '../components/ui.js';
import { Icon } from '../components/Icon.js';
import { type Key, useT } from '../i18n/index.js';
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

const ERROR_KEYS: Readonly<Record<string, Key>> = {
  stale: 'studio.gate.stale',
  settled: 'studio.gate.settled',
  gone: 'studio.gate.gone',
};

export function StartGateCard({ gate, from, askedAt, now = Date.now(), onAnswer }: StartGateCardProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();

  const title = t(gate.kind === 'start' ? 'studio.gate.startTitle' : 'studio.gate.changesTitle', { plan: gate.plan });
  const added = gate.added ?? { milestones: 0, tasks: 0, points: 0 };
  const numbers =
    gate.kind === 'start'
      ? gate.milestones === 1
        ? t('studio.gate.milestoneOne', { points: gate.points })
        : t('studio.gate.milestones', { milestones: gate.milestones, points: gate.points })
      : [
          added.milestones === 1 ? t('studio.gate.addedMilestoneOne') : t('studio.gate.addedMilestones', { milestones: added.milestones }),
          added.tasks === 1 ? t('studio.gate.addedTaskOne') : t('studio.gate.addedTasks', { tasks: added.tasks }),
          t('studio.gate.addedPoints', { points: added.points }),
        ].join(' · ');
  const meta = [from ? t('studio.gate.from', { name: from }) : '', askedAt ? noticeAgo(askedAt, now) : ''].filter(Boolean).join(' · ');

  const answer = async (a: StartGateAnswer): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await onAnswer(a);
    setBusy(false);
    if (result.ok) return;
    const key = ERROR_KEYS[result.error];
    setError(key ? t(key) : t('studio.gate.failed', { error: result.error }));
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
            {t('studio.gate.reasonLabel')}
          </label>
          <textarea
            id={`gate-reason-${gate.plan}`}
            className={s.input}
            value={reason}
            maxLength={1000}
            rows={2}
            placeholder={t('studio.gate.reasonPlaceholder')}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className={s.buttons}>
            <Button size="small" variant="plain" disabled={busy} onClick={() => setDeclining(false)}>
              {t('studio.gate.cancel')}
            </Button>
            <Button size="small" variant="primary" disabled={busy} onClick={() => void answer({ approve: false, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
              {busy ? t('studio.gate.sending') : t('studio.gate.sendDecline')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={s.buttons}>
          <Button size="small" variant="primary" disabled={busy} onClick={() => void answer({ approve: true })}>
            {busy ? t('studio.gate.sending') : t('studio.gate.approve')}
          </Button>
          <Button size="small" variant="plain" disabled={busy} onClick={() => setDeclining(true)}>
            {t('studio.gate.decline')}
          </Button>
        </div>
      )}
    </li>
  );
}
