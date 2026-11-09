import { type ReactNode, useState } from 'react';
import type { PlanReview, SharedPlan } from '@beluga/core/team/model.js';
import { teammatesOf } from '@beluga/core/team/model.js';
import { Icon } from '../components/Icon.js';
import { ActionsDropdown, type ActionItem } from '../components/SpecMenu.js';
import { Avatar, Button, Empty, IconButton, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { sameDeep } from '../lib/stable.js';
import { ago } from '../tasks/tasks-model.js';
import p from '../plans/plans.module.css';
import s from './shared-plans.module.css';
import { primaryKey } from '../lib/shortcuts-model.js';
import { t, useT } from '../i18n/index.js';

/**
 * Plans shared within a team (BLG-225). Yours: Share Plan with Team in the plan's •••, and Team
 * Reviews on its page (comments, approvals, suggested changes with Apply). A teammate's: listed in
 * Plans under "Shared by your team", and its own page, read-only, where you approve (the one main
 * action), comment, or suggest a change to a task.
 */

function useSay(): <T>(p: Promise<T>, done?: string) => Promise<T | undefined> {
  const { client } = useBeluga();
  return async (pr, done) => {
    try {
      const r = await pr;
      if (done) toast(client, done, 'success');
      return r;
    } catch (err) {
      toast(client, err instanceof Error ? err.message : String(err), 'error');
      return undefined;
    }
  };
}

/** The plan's ••• items: Share Plan with Team / Stop Sharing with Team (only when the project is a team's). */
export function usePlanTeamItems(planId: string, projectId: string): readonly ActionItem[] {
  const mates = useApp((st) => teammatesOf(st.team, projectId), sameDeep);
  const shared = useApp((st) => Boolean(st.team.planShares[planId]));
  const api = useApi();
  const say = useSay();
  useT();
  if (!mates.length && !shared) return [];
  return [shared ? { label: t('team.plans.stopSharing'), icon: 'people', separate: true, onSelect: () => void say(api.team.sharePlan(planId, false)) } : { label: t('team.plans.share'), icon: 'people', separate: true, onSelect: () => void say(api.team.sharePlan(planId, true)) }];
}

const reviewWords = (r: PlanReview): string => (r.kind === 'approve' ? t('team.plans.approvedIt') : r.kind === 'suggest' ? (r.ops?.length === 1 ? t('team.plans.suggestsOne') : t('team.plans.suggestsMany', { n: r.ops?.length ?? 0 })) : t('team.plans.commented'));

/** What one suggested op changes, in words. */
function opWords(op: unknown): string {
  const o = op as { op?: string; id?: string; patch?: { title?: string; goal?: string }; title?: string; milestone?: unknown };
  switch (o.op) {
    case 'update_task':
      return `${t('team.plans.changeTask', { id: o.id ?? '' })}${o.patch?.title ? t('team.plans.changeTo', { title: o.patch.title }) : ''}${o.patch?.goal ? `: ${o.patch.goal}` : ''}`;
    case 'add_task':
      return t('team.plans.addTask');
    case 'remove_task':
      return t('team.plans.takeOut', { id: o.id ?? '' });
    case 'retitle':
      return `${t('team.plans.rename')}${o.title ? ` “${o.title}”` : ''}`;
    default:
      return o.op ? o.op.replace(/_/g, ' ') : t('team.plans.aChange');
  }
}

function ReviewRow({ r, trailing }: { r: PlanReview; trailing?: ReactNode }) {
  useT();
  return (
    <li className={s.review}>
      <Avatar name={r.name} id={r.by} size={22} />
      <div className={s.reviewMain}>
        <div className={s.reviewHead}>
          <strong>{r.name}</strong> {reviewWords(r)}
          {r.kind === 'approve' ? <Icon name="check" size={12} /> : null}
          <span className={s.when}>{ago(r.at)}</span>
          {r.settled ? <span className={s.settled}>{r.settled === 'applied' ? t('team.plans.applied') : t('team.plans.setAside')}</span> : null}
        </div>
        {r.text ? <div className={s.reviewText}>{r.text}</div> : null}
        {r.ops?.length ? (
          <ul className={s.ops}>
            {r.ops.map((op, i) => (
              <li key={i}>{opWords(op)}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {trailing ? <span className={s.reviewButtons}>{trailing}</span> : null}
    </li>
  );
}

/** Your plan's reviews from the team: Apply on a suggestion (Set Aside in its •••). */
export function TeamReviews({ planId }: { planId: string }) {
  const share = useApp((st) => st.team.planShares[planId], sameDeep);
  const api = useApi();
  const say = useSay();
  useT();
  if (!share) return null;
  const names = share.peers.length ? t('team.plans.sharedWithTeam') : t('team.plans.sharedNobody');
  return (
    <section className={s.panel} aria-label={t('team.plans.teamReviews')}>
      <div className={s.panelHead}>
        <Icon name="people" size={13} />
        <span>{names}</span>
        <span className={s.when}>{share.reviews.length ? t('team.plans.reviews', { n: share.reviews.length }) : t('team.plans.noReviews')}</span>
      </div>
      {share.reviews.length ? (
        <ul className={s.reviews}>
          {share.reviews.map((r) => (
            <ReviewRow
              key={r.id}
              r={r}
              trailing={
                r.kind === 'suggest' && !r.settled ? (
                  <>
                    <Button size="small" variant="primary" onClick={() => void say(api.team.applySuggestion(planId, r.id), t('team.plans.appliedToast'))}>
                      {t('team.plans.apply')}
                    </Button>
                    <ActionsDropdown items={[{ label: t('team.plans.setAsideButton'), onSelect: () => void say(api.team.dismissSuggestion(planId, r.id)) }]}>
                      <IconButton icon="more" label={t('team.plans.more')} />
                    </ActionsDropdown>
                  </>
                ) : undefined
              }
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** "Shared by your team" in Plans: teammates' plans for this project. */
export function SharedPlansList({ projectId }: { projectId: string }) {
  const plans = useApp((st) => st.team.plans.filter((x) => x.projectId === projectId), sameDeep);
  const actions = useActions();
  useT();
  if (!plans.length) return null;
  return (
    <>
      <div className={s.caption}>{t('team.plans.sharedBy')}</div>
      <ul className={p.rows} aria-label={t('team.plans.sharedByList')}>
        {plans.map((plan) => (
          <li key={`${plan.owner}/${plan.id}`}>
            <button type="button" className={p.row} onClick={() => actions.run({ type: 'view', view: { kind: 'team_plan', owner: plan.owner, id: plan.id } })} aria-label={t('team.plans.rowLabel', { title: plan.title, name: plan.ownerName })}>
              <Avatar name={plan.ownerName} id={plan.owner} size={20} />
              <span className={p.rowMain}>
                <span className={p.rowTitle}>{plan.title}</span>
                <span className={p.rowSub}>
                  {t('team.plans.rowSub', { name: plan.ownerName, milestones: plan.body.milestones.length, tasks: plan.body.milestones.reduce((n, m) => n + m.tasks.length, 0), status: plan.status === 'draft' ? t('team.plans.draft') : plan.status === 'active' ? t('team.plans.running') : t('team.plans.done') })}
                </span>
              </span>
              <span className={p.rowWhen}>{ago(plan.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A teammate's plan, read-only: Approve (the main action), a comment, a change suggested on a task. */
export function SharedPlanPage({ owner, id }: { owner: string; id: string }) {
  const plan = useApp((st) => st.team.plans.find((x) => x.owner === owner && x.id === id), sameDeep);
  const self = useApp((st) => st.selfId);
  const actions = useActions();
  const api = useApi();
  const say = useSay();
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState<string | undefined>();
  useT();
  if (!plan) return <Empty icon="flag" title={t('team.plans.notShared')} detail={t('team.plans.notSharedDetail')} />;
  const approved = plan.reviews.some((r) => r.by === self && r.kind === 'approve' && r.rev === plan.rev);
  const send = (): void => {
    if (!comment.trim()) return;
    void say(api.team.reviewPlan(owner, id, { kind: 'comment', text: comment.trim() })).then((r) => r && setComment(''));
  };
  const back = (): void => actions.run({ type: 'view', view: { kind: 'plans', projectId: plan.projectId } });
  return (
    <div className={s.page}>
      <header className={s.head}>
        <IconButton icon="back" label={t('team.plans.allPlans')} onClick={back} />
        <div className={s.headMain}>
          <h1 className={s.title}>{plan.title}</h1>
          <div className={s.meta}>
            <Avatar name={plan.ownerName} id={plan.owner} size={14} />
            {t('team.plans.meta', { name: plan.ownerName, status: plan.status === 'draft' ? t('team.plans.aDraft') : plan.status === 'active' ? t('team.plans.approvedRunning') : t('team.plans.done') })}
          </div>
        </div>
        <Button variant="primary" size="small" icon="check" disabled={approved} onClick={() => void say(api.team.reviewPlan(owner, id, { kind: 'approve' }), t('team.plans.toldApprove', { name: plan.ownerName }))}>
          {approved ? t('team.plans.approved') : t('team.plans.approve')}
        </Button>
      </header>
      {plan.body.goal ? <p className={s.goal}>{plan.body.goal}</p> : null}
      <ol className={s.milestones}>
        {plan.body.milestones.map((m) => (
          <li key={m.id} className={s.milestone}>
            <div className={s.mTitle}>
              <Icon name="flag" size={13} />
              {m.title}
            </div>
            {m.goal ? <div className={s.mGoal}>{m.goal}</div> : null}
            {m.criteria.length ? (
              <ul className={s.criteria}>
                {m.criteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : null}
            <ul className={s.tasks}>
              {m.tasks.map((task) => (
                <li key={task.id} className={cx(s.task, editing === task.id && s.taskEditing)}>
                  <div className={s.taskLine}>
                    <Icon name="task" size={12} />
                    <span className={s.taskTitle}>{task.title}</span>
                    {task.assignee === 'me' ? <span className={s.when}>{t('team.plans.forName', { name: plan.ownerName })}</span> : null}
                    <ActionsDropdown items={[{ label: t('team.plans.suggestChange'), icon: 'pencil', onSelect: () => setEditing(task.id) }]}>
                      <IconButton icon="more" label={t('team.plans.moreFor', { name: task.title })} />
                    </ActionsDropdown>
                  </div>
                  {task.goal ? <div className={s.taskGoal}>{task.goal}</div> : null}
                  {editing === task.id ? <Suggest plan={plan} task={task} onDone={() => setEditing(undefined)} /> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <section className={s.panel} aria-label={t('team.plans.reviewsLabel')}>
        <div className={s.panelHead}>
          <Icon name="chat" size={13} />
          <span>{t('team.plans.teamSaid')}</span>
        </div>
        {plan.reviews.length ? (
          <ul className={s.reviews}>
            {plan.reviews.map((r) => (
              <ReviewRow key={r.id} r={r} />
            ))}
          </ul>
        ) : null}
        <div className={s.compose}>
          <textarea
            className={s.input}
            value={comment}
            placeholder={t('team.plans.commentFor', { name: plan.ownerName })}
            rows={2}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && primaryKey(e)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button size="small" disabled={!comment.trim()} onClick={send}>
            {t('team.plans.comment')}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** A change to one task, suggested: its title and goal as you'd have them. */
function Suggest({ plan, task, onDone }: { plan: SharedPlan; task: SharedPlan['body']['milestones'][number]['tasks'][number]; onDone: () => void }) {
  const api = useApi();
  const say = useSay();
  const [title, setTitle] = useState(task.title);
  const [goal, setGoal] = useState(task.goal ?? '');
  const [why, setWhy] = useState('');
  useT();
  const changed = title.trim() !== task.title || goal.trim() !== (task.goal ?? '');
  const go = (): void => {
    const patch = { ...(title.trim() !== task.title ? { title: title.trim() } : {}), ...(goal.trim() !== (task.goal ?? '') ? { goal: goal.trim() } : {}) };
    void say(api.team.reviewPlan(plan.owner, plan.id, { kind: 'suggest', ops: [{ op: 'update_task', id: task.id, patch }], ...(why.trim() ? { text: why.trim() } : {}) }), t('team.plans.suggested', { name: plan.ownerName })).then((r) => r && onDone());
  };
  return (
    <div className={s.suggest}>
      <input className={s.input} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('team.plans.title')} />
      <textarea className={s.input} value={goal} rows={3} onChange={(e) => setGoal(e.target.value)} aria-label={t('team.plans.goal')} placeholder={t('team.plans.goalPlaceholder')} />
      <input className={s.input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('team.plans.whyPlaceholder')} aria-label={t('team.plans.why')} />
      <div className={s.suggestBar}>
        <Button size="small" variant="quiet" onClick={onDone}>
          {t('team.plans.cancel')}
        </Button>
        <Button size="small" variant="primary" disabled={!changed || !title.trim()} onClick={go}>
          {t('team.plans.suggest')}
        </Button>
      </div>
    </div>
  );
}
