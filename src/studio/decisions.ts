import { decisionQid } from '../core/plans/decisions.js';
import type { Plan, PlanDecision, PlanTask } from '../core/plans/model.js';
import type { PlanView, TaskState } from '../core/plans/progress.js';
import type { Store } from '../core/store.js';
import type { CustomerDecision, PlanFacts } from './actions.js';

/**
 * Which plan decisions a customer may see and answer (docs/studio-gates.md §6, decision
 * decisions-audience).
 *
 * A task's decision is the operator's unless it says `audience: 'customer'`. Even then it stays the
 * operator's when its words touch an account, a key, a payment, a store console or a domain: the
 * customer view and the answer path use this one filter, so a sensitive question can't reach a
 * customer by being mislabeled. This file has the only numbering of decisions (`d-m<i>-t<j>`), and
 * view.ts builds its `decisions[]` from it.
 */

/** Accounts, keys, money and the things only the operator holds (matched on the question and options). */
export const SENSITIVE =
  /(密钥|秘钥|token|密码|口令|账号|帐号|账户|付款|支付|银行卡|信用卡|证书|域名|商店后台|后台账号|api[\s_-]*key|password|passphrase|secret|credential|billing|payment|card number|certificate|keystore|private key)/i;

const wordsOf = (task: PlanTask): string => {
  const d = task.decision;
  if (!d) return '';
  return [d.question, ...d.options.flatMap((o) => [o.label, o.description ?? ''])].join(' ');
};

/** A decision the operator answers: not marked for the customer, or too sensitive to show one. */
export const operatorOnly = (task: PlanTask): boolean => task.audience !== 'customer' || SENSITIVE.test(wordsOf(task));

/** A task that isn't in the customer's plan at all: yours, and not theirs to see. */
export const hiddenFromCustomer = (task: PlanTask): boolean => task.assignee === 'me' && operatorOnly(task);

const FINISHED: ReadonlySet<TaskState> = new Set(['review', 'planned', 'done', 'canceled', 'missing']);
const NOT_YET: ReadonlySet<TaskState> = new Set(['draft', 'later', 'blocked']);

export interface CustomerDecisionView {
  readonly decisionId: string;
  readonly question: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }>;
  readonly multi: boolean;
  readonly open: boolean;
}

interface Eligible {
  readonly task: PlanTask;
  readonly decision: PlanDecision;
  readonly decisionId: string;
  readonly open: boolean;
}

/** The decisions a customer may see, numbered by position (`d-m<i>-t<j>`), in plan order. */
function eligible(view: PlanView): Eligible[] {
  return view.milestones
    .flatMap((m, i) =>
      m.tasks.flatMap((t, j): Eligible[] => {
        const task = t.task;
        if (!task.decision || operatorOnly(task)) return [];
        return [
          {
            task,
            decision: task.decision,
            decisionId: `d-m${i}-t${j}`,
            open: view.plan.status === 'active' && !view.plan.paused && !FINISHED.has(t.state) && !NOT_YET.has(t.state),
          },
        ];
      }),
    )
    .slice(0, 40);
}

/** What the customer's view draws: questions, options with their descriptions, and whether they're open. */
export function studioDecisions(view: PlanView): CustomerDecisionView[] {
  return eligible(view).map((e) => ({
    decisionId: e.decisionId,
    question: e.decision.question,
    options: e.decision.options.slice(0, 20).map((o, k) => ({ id: `o${k}`, label: o.label, ...(o.description ? { description: o.description } : {}) })),
    multi: Boolean(e.decision.multi),
    open: e.open,
  }));
}

/** What the inbox and a customer's answer need: the question, the option labels, and the card's qid (never sent). */
export function customerDecisions(view: PlanView): PlanFacts['decisions'] {
  const out: Record<string, CustomerDecision> = {};
  for (const e of eligible(view)) {
    out[e.decisionId] = {
      audience: 'customer',
      open: e.open,
      qid: decisionQid(view.plan.id, e.task.id),
      question: e.decision.question,
      options: Object.fromEntries(e.decision.options.map((o, k) => [`o${k}`, o.label])),
      ...(e.decision.multi ? { multi: true } : {}),
    };
  }
  return out;
}

/**
 * The inbox's `decisions` plug: the same list, plus one warning in the plan's conversation when a
 * decision marked for the customer touches something only the operator may answer (it stays theirs).
 */
export class StudioDecisions {
  private readonly store: Store;
  private readonly warned = new Set<string>();

  constructor(d: { readonly store: Store }) {
    this.store = d.store;
  }

  decisions(plan: Plan, view: PlanView): PlanFacts['decisions'] {
    for (const m of view.milestones) {
      for (const t of m.tasks) {
        const task = t.task;
        if (!task.decision || task.audience !== 'customer' || !SENSITIVE.test(wordsOf(task))) continue;
        const key = `${plan.id}\u0000${task.id}\u0000${plan.draftRev}`;
        if (this.warned.has(key)) continue;
        this.warned.add(key);
        this.store.dispatch({
          type: 'system',
          channel: plan.home,
          text: `A decision marked for the customer (“${task.title}”) touches accounts, keys or payments: it stays with you.`,
          level: 'warn',
        });
      }
    }
    return customerDecisions(view);
  }
}
