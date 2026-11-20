import type { StudioPlanView } from '../../../src/studio/protocol.js';
import { pagePhase } from './plan-phase.js';
import { t, type Lang } from './strings/table.js';
import type { RequestSummary, WaitReason } from './views.js';

export type TodoKind = 'decision' | 'review' | 'changes' | 'confirm';

/** One thing waiting on the customer; `key` is stable across loads so an acted-on card can hide. */
export interface Todo {
  readonly kind: TodoKind;
  readonly pid: string;
  readonly planRef: string;
  readonly title: string;
  readonly sub: string;
  readonly key: string;
  readonly decisionId?: string;
  readonly milestoneRef?: string;
  readonly draftRev?: number;
}

/** 带项目名与更新时间的纯待办卡片模型，供 `todo.ts` 与 `todo-store.ts` 共用，避免引入 RN/Expo 类型。 */
export interface TodoCardItem extends Todo {
  readonly projectName: string;
  readonly updatedAt: number;
}

/**
 * What a plan asks of the customer, using the same priority as the plan page: a plan yields
 * decision cards (one per open question) or exactly one of review / changes / confirm, and
 * nothing while it waits on the studio or the AI.
 */
export function todosOf(pid: string, view: StudioPlanView, lang: Lang): Todo[] {
  const phase = pagePhase(view);
  if (phase === 'decide') {
    const open = view.decisions.filter((d) => d.open);
    return open.map((decision, i) => ({
      kind: 'decision',
      pid,
      planRef: view.planRef,
      title: view.title,
      sub: `${t(lang, 'decision.count', { i: i + 1, n: open.length })} · ${decision.question}`,
      key: `decision:${view.planRef}:${decision.decisionId}`,
      decisionId: decision.decisionId,
    }));
  }
  if (phase === 'review') {
    const milestone = view.milestones.find((m) => m.status === 'review');
    if (!milestone) return [];
    return [
      {
        kind: 'review',
        pid,
        planRef: view.planRef,
        title: view.title,
        sub: t(lang, 'todo.reviewSub', { m: milestone.title }),
        key: `review:${view.planRef}:${milestone.ref}`,
        milestoneRef: milestone.ref,
        draftRev: view.draftRev,
      },
    ];
  }
  if (phase === 'changes' && view.draftDiff) {
    return [
      {
        kind: 'changes',
        pid,
        planRef: view.planRef,
        title: view.title,
        sub: t(lang, 'todo.changesSub', { a: view.draftDiff.added.length, c: view.draftDiff.changed.length, r: view.draftDiff.removed.length }),
        key: `changes:${view.planRef}`,
        draftRev: view.draftRev,
      },
    ];
  }
  if (phase === 'confirm') {
    return [
      {
        kind: 'confirm',
        pid,
        planRef: view.planRef,
        title: view.title,
        sub: t(lang, 'todo.confirmSub'),
        key: `confirm:${view.planRef}`,
        draftRev: view.draftRev,
      },
    ];
  }
  return [];
}

export interface WaitingTodoItem {
  readonly id: string;
  readonly requestId: string;
  readonly requestTitle: string;
  readonly projectName: string;
  readonly reason: WaitReason;
  readonly message: string;
  readonly etaText: string;
  readonly updatedAt: number;
}

const URGENCY_RANK: Record<TodoKind, number> = {
  decision: 0,
  review: 1,
  changes: 2,
  confirm: 3,
};

/** 按紧急程度排序「要你做的」：决策 > 验收 > 改动 > 确认开工，同级按到达时间升序。 */
export function sortNeedsYouTodos<T extends Pick<TodoCardItem, 'kind' | 'updatedAt' | 'key'>>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    const rankDiff = URGENCY_RANK[a.kind] - URGENCY_RANK[b.kind];
    if (rankDiff !== 0) return rankDiff;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
    return a.key.localeCompare(b.key);
  });
}

function defaultWaitEta(reason: WaitReason, lang: Lang): string {
  switch (reason) {
    case 'offline':
      return t(lang, 'todo.waitOfflineEta');
    case 'queued':
      return t(lang, 'todo.waitQueuedEta');
    case 'quota':
      return t(lang, 'todo.waitQuotaEta');
    case 'needs-human':
      return t(lang, 'todo.waitHumanEta');
  }
}

/**
 * 把待办拆成两组：
 * 1. `needsYou`：要你做的（按紧急程度排序）；
 * 2. `waiting`：在等待，你不用做什么（只读，写清在等什么与何时会好）。
 */
export function partitionTodos<T extends TodoCardItem>({
  todos,
  requests = [],
  waitingCards = [],
  lang,
}: {
  readonly todos: readonly T[];
  readonly requests?: readonly RequestSummary[];
  readonly waitingCards?: readonly WaitingTodoItem[];
  readonly lang: Lang;
}): {
  readonly needsYou: readonly T[];
  readonly waiting: readonly WaitingTodoItem[];
} {
  const needsYou = sortNeedsYouTodos(todos);
  const byReq = new Map<string, WaitingTodoItem>();
  for (const card of waitingCards) {
    byReq.set(card.requestId, card);
  }
  for (const req of requests) {
    if (req.status !== 'waiting' || byReq.has(req.id)) continue;
    const reason: WaitReason = req.waitReason ?? 'queued';
    byReq.set(req.id, {
      id: `wait:${req.id}`,
      requestId: req.id,
      requestTitle: req.title,
      projectName: req.projectName,
      reason,
      message: req.statusLine,
      etaText: defaultWaitEta(reason, lang),
      updatedAt: req.updatedAt,
    });
  }
  const waiting = [...byReq.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  return { needsYou, waiting };
}
