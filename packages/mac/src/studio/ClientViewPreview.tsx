import { useMemo, useState } from 'react';
import type { PlanView } from '@beluga/core/plans/progress.js';
import type { StudioPlanView } from '@beluga/studio/protocol.js';
import { studioPlanView } from '@beluga/studio/view.js';
import { FormSheet } from '../components/FormSheet.js';
import { Button, Tip, cx } from '../components/ui.js';
import { type Key, useT } from '../i18n/index.js';
import s from './client-view-preview.module.css';

/**
 * The plan page's "Customer view" (Synon Studio, M1): the plan as a customer would get it, built by
 * the same src/studio/view.ts the daemon sends, so you see it before you approve. Read-only.
 */
export function ClientViewPreview({ view }: { view: PlanView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tip label={t('studio.preview.tip')}>
        <Button size="small" variant="quiet" icon="eye" aria-pressed={open} onClick={() => setOpen(true)}>
          {t('studio.preview.button')}
        </Button>
      </Tip>
      {open ? (
        <FormSheet title={t('studio.preview.title')} intro={t('studio.preview.intro')} icon="eye" submitLabel={t('studio.preview.done')} cancelLabel={t('studio.preview.done')} hideSubmit width={440} onSubmit={() => setOpen(false)} onCancel={() => setOpen(false)}>
          <Preview view={view} />
        </FormSheet>
      ) : null}
    </>
  );
}

/** The customer's view of the plan, or why it couldn't be built. */
export function Preview({ view }: { view: PlanView }) {
  const t = useT();
  const built = useMemo((): { v: StudioPlanView } | { why: string } => {
    try {
      return { v: studioPlanView({ planRef: 'preview', view }) };
    } catch (err) {
      return { why: err instanceof Error ? err.message.slice(0, 200) : String(err) };
    }
  }, [view]);
  if ('why' in built) return <p className={s.small}>{t('studio.preview.failed', { why: built.why })}</p>;
  return <CustomerPlan v={built.v} />;
}

const status = (k: string): Key => `studio.preview.status.${k}` as Key;

/** The view itself, as a phone-width page (shared with tests and, later, the customer app's look). */
export function CustomerPlan({ v }: { v: StudioPlanView }) {
  const t = useT();
  const pct = v.progress.total ? Math.round((v.progress.done / v.progress.total) * 100) : 0;
  return (
    <div className={s.phone} data-testid="studio-client-view">
      <div className={cx(s.status, v.waitingOn === 'customer' && s.statusCustomer)}>{t(`studio.preview.waiting.${v.waitingOn}` as Key)}</div>
      <div>
        <h3 className={s.title}>{v.title}</h3>
        <p className={s.headline}>{v.headline}</p>
      </div>
      {v.goal ? <p className={s.goal}>{v.goal}</p> : null}
      <div className={s.section}>
        <div className={s.bar} aria-label={t('studio.preview.progress', { done: v.progress.done, total: v.progress.total })}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className={s.small}>{t('studio.preview.progress', { done: v.progress.done, total: v.progress.total })}</p>
      </div>

      {v.draftDiff ? (
        <div className={s.section}>
          <h4 className={s.sectionTitle}>{t('studio.preview.changes')}</h4>
          <div className={s.card}>
            {v.draftDiff.added.map((a, i) => (
              <p key={`a${i}`} className={s.small}>
                {t('studio.preview.added')} · {a.title}
              </p>
            ))}
            {v.draftDiff.changed.map((c, i) => (
              <p key={`c${i}`} className={s.small}>
                {t('studio.preview.changed')} · {c.title}
              </p>
            ))}
            {v.draftDiff.removed.map((r, i) => (
              <p key={`r${i}`} className={s.small}>
                {t('studio.preview.removed')} · {r.title}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {v.review ? (
        <div className={s.section}>
          <h4 className={s.sectionTitle}>{t('studio.preview.review')}</h4>
          <div className={s.card}>
            <p className={s.small}>{v.review.notes}</p>
          </div>
        </div>
      ) : null}

      <div className={s.section}>
        <h4 className={s.sectionTitle}>{t('studio.preview.decisions')}</h4>
        {v.decisions.length ? (
          v.decisions.map((d) => (
            <div key={d.decisionId} className={s.card}>
              <div className={s.row}>
                <span className={s.name}>{d.question}</span>
                <span className={cx(s.chip, d.open && s.chipOpen)}>{d.open ? t('studio.preview.open') : t('studio.preview.answered')}</span>
              </div>
              {d.options.map((o) => (
                <div key={o.id} className={s.option}>
                  {o.label}
                  {o.description ? <small>{o.description}</small> : null}
                </div>
              ))}
            </div>
          ))
        ) : (
          <p className={s.small}>{t('studio.preview.noDecisions')}</p>
        )}
      </div>

      <div className={s.section}>
        <h4 className={s.sectionTitle}>{t('studio.preview.milestones')}</h4>
        {v.milestones.map((m) => (
          <div key={m.ref} className={s.card}>
            <div className={s.row}>
              <span className={s.name}>{m.title}</span>
              <span className={s.chip}>{t(status(m.status))}</span>
            </div>
            {m.goal ? <p className={s.small}>{m.goal}</p> : null}
            {m.criteria.length ? (
              <ul className={s.list}>
                {m.criteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : null}
            <ul className={s.tasks}>
              {m.tasks.map((task) => (
                <li key={task.ref} className={s.task}>
                  <span>{task.title}</span>
                  <span className={s.taskStatus}>{t(status(task.status))}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {v.activity.length ? (
        <div className={s.section}>
          <h4 className={s.sectionTitle}>{t('studio.preview.activity')}</h4>
          <ul className={s.list}>
            {v.activity
              .slice(-8)
              .reverse()
              .map((a, i) => (
                <li key={i}>{a.text}</li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
