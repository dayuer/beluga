import type { StudioDecision, StudioMilestone, StudioPlanView, StudioTurn } from '../../../src/studio/protocol';
import { tRequests } from './strings/requests';
import { t, type Lang } from './strings/table';
import type {
  RequestMessage,
  RequestStep,
  RequestSummary,
  RequestView,
  ResultDrawerView,
  StudioCard,
  WaitReason,
} from './views';

/**
 * 把中台的 `StudioPlanView` 映射成需求详情页的 `RequestView`（SS-223）。
 *
 * 纯函数：同一个 view 与上下文给出同一个 RequestView，不读时钟、不碰网络。
 * 卡片按阶段给出：
 * - 起草：理解卡（草稿的里程碑作要点），草稿就绪后加上开工卡；
 * - 待开工：开工卡（需签名，由 card-stream-signed 接动作，这里只占位）；
 * - 在做：步骤条；工作室离线时补一张等待卡；
 * - 待验收：步骤条 + 交付卡（需签名）；
 * - 完成：步骤条；
 * - 任何阶段有未答的决策就出问题卡，有草稿改动就出改动卡（需签名）。
 * 代码卡与设计稿卡要等 protocol 带上 repoUrl / 设计稿字段（P2/P3），现在 protocol 里没有。
 */
/** 客户这次上传的设计稿包（上传进度来自本机的上传会话，不是中台视图）。 */
export interface RequestDesignPackage {
  readonly name: string;
  readonly fileCount: number;
  readonly imageCount: number;
  readonly specCount: number;
  readonly progress: number;
  readonly done?: boolean;
}

export interface RequestViewInput {
  /** 需求所属项目；路由只带 planRef，项目从 `?project=` 或缓存的需求列表来。 */
  readonly projectId: string;
  readonly projectName?: string;
  readonly platform?: string;
  readonly lang: Lang;
  /** 执行机器（工作室 daemon）是否在线；false 时整页进入离线态。 */
  readonly studioOnline?: boolean;
  /** 中台给的更新时间（PlanRes.updatedAt）；缺省用 0，不用本地时钟。 */
  readonly updatedAt?: number;
  /** 同一项目正在（或已经）上传的设计稿包，排在最前面。 */
  readonly design?: RequestDesignPackage;
}

function messageOf(turn: StudioTurn): RequestMessage {
  return { id: turn.id, role: turn.who, text: turn.text, createdAt: turn.at };
}

function stepStatusOf(status: StudioMilestone['status']): RequestStep['status'] {
  switch (status) {
    case 'planned':
      return 'todo';
    case 'waiting':
      return 'waiting';
    case 'working':
    case 'checking':
      return 'active';
    case 'review':
      return 'waiting';
    case 'passed':
      return 'done';
  }
}

function stepOf(milestone: StudioMilestone): RequestStep {
  if (milestone.status === 'review') {
    return { id: milestone.ref, title: milestone.title, status: 'waiting', waitReason: 'needs-human' };
  }
  if (milestone.status === 'waiting') {
    return { id: milestone.ref, title: milestone.title, status: 'waiting', waitReason: 'queued' };
  }
  return { id: milestone.ref, title: milestone.title, status: stepStatusOf(milestone.status) };
}

function questionCardOf(decision: StudioDecision, index: number, total: number, createdAt: number): StudioCard {
  return {
    id: decision.decisionId,
    kind: 'question',
    createdAt,
    status: 'pending',
    index,
    total,
    prompt: decision.question,
    options: decision.options.map((option) => ({
      id: option.id,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
    })),
    allowFreeText: true,
  };
}

function statusOf(
  view: StudioPlanView,
  input: RequestViewInput,
): Pick<RequestSummary, 'status' | 'statusLine' | 'waitReason'> {
  const offline = input.studioOnline === false;
  if (offline && view.stage !== 'done') {
    return {
      status: 'waiting',
      statusLine: tRequests(input.lang, 'requests.waitingRunnerOffline'),
      waitReason: 'offline',
    };
  }
  if (view.waitingOn === 'customer') {
    return { status: 'needs-you', statusLine: view.headline };
  }
  if (view.stage === 'done') {
    return { status: 'done', statusLine: view.headline };
  }
  if (view.waitingOn === 'studio') {
    return { status: 'waiting', statusLine: view.headline, waitReason: 'queued' };
  }
  return { status: 'working', statusLine: view.headline };
}

function cardsOf(view: StudioPlanView, input: RequestViewInput): StudioCard[] {
  const createdAt = input.updatedAt ?? 0;
  const offline = input.studioOnline === false;
  const cards: StudioCard[] = [];

  if (input.design) {
    const done = input.design.done === true || input.design.progress >= 1;
    cards.push({
      id: 'design',
      kind: 'design',
      createdAt,
      status: done ? 'done' : 'pending',
      fileCount: input.design.fileCount,
      totalBytes: 0,
      imageCount: input.design.imageCount,
      specCount: input.design.specCount,
      skipped: [],
      packageName: input.design.name,
      progress: input.design.progress,
    } as StudioCard);
  }

  // 开工 Gate 已经升起（等工作室批准）时，理解卡不再带「对，就是这样」的动作。
  const gatePendingEarly = view.gate?.state === 'pending';
  if (view.stage === 'drafting' && !gatePendingEarly) {
    const points = view.milestones.map((m) => m.title).filter(Boolean);
    cards.push({
      id: `understanding-${view.draftRev}`,
      kind: 'understanding',
      createdAt,
      status: 'pending',
      points: points.length > 0 ? points : [view.goal].filter(Boolean),
      requiresSignature: false,
    });
  }

  const open = view.decisions.filter((d) => d.open);
  open.forEach((decision, i) => {
    cards.push(questionCardOf(decision, i + 1, open.length, createdAt));
  });

  if (view.draftDiff) {
    const diff = view.draftDiff;
    cards.push({
      id: `changes:${view.planRef}`,
      kind: 'changes',
      createdAt,
      status: 'pending',
      summary: t(input.lang, 'todo.changesSub', {
        a: diff.added.length,
        c: diff.changed.length,
        r: diff.removed.length,
      }),
      added: diff.added.map((x) => x.title),
      modified: diff.changed.map((x) => x.title),
      removed: diff.removed.map((x) => x.title),
      requiresSignature: true,
    });
  }

  const gatePending = gatePendingEarly;
  if (
    (view.gate?.kind === 'start' && gatePending) ||
    (view.stage === 'drafting' && view.milestones.length > 0 && !view.typing && !gatePending)
  ) {
    cards.push({
      id: `confirm:${view.planRef}`,
      kind: 'start',
      createdAt,
      status: 'pending',
      planTitle: view.title,
      stepCount: view.milestones.length,
      requiresSignature: true,
    });
  }

  if (view.milestones.length > 0) {
    cards.push({
      id: 'steps',
      kind: 'steps',
      createdAt,
      status: view.stage === 'done' ? 'done' : 'pending',
      steps: view.milestones.map(stepOf),
    });
  }

  const waitingReason: WaitReason | null = offline && view.stage !== 'done' ? 'offline' : view.waitingOn === 'studio' ? 'queued' : null;
  if (waitingReason && (view.stage === 'running' || view.stage === 'drafting' || view.stage === 'awaiting-start')) {
    cards.push({
      id: `wait-${waitingReason}`,
      kind: 'wait',
      createdAt,
      status: 'pending',
      reason: waitingReason,
      message: view.headline,
    });
  }

  if (view.release) {
    cards.push({
      id: `release-${view.release.envId}`,
      kind: 'release',
      createdAt,
      status: 'pending',
      envId: view.release.envId,
      envTitle: view.release.envTitle,
      version: view.release.version,
      ...(view.release.lastVersion ? { lastVersion: view.release.lastVersion } : {}),
      ...(view.release.lastReleaseAt !== undefined ? { lastReleaseAt: view.release.lastReleaseAt } : {}),
      requiresSignature: true,
    });
  }

  if (view.stage === 'awaiting-review') {
    const reviewMilestone = view.milestones.find((m) => m.status === 'review');
    const round = view.milestones.filter((m) => m.status === 'passed').length + 1;
    cards.push({
      id: reviewMilestone?.ref ?? 'review',
      kind: 'delivery',
      createdAt,
      status: 'pending',
      round,
      summary: view.review?.notes || view.headline,
      criteria: reviewMilestone?.criteria ?? [],
      screenshots: [],
      requiresSignature: true,
    });
  }

  return cards;
}

function resultsOf(view: StudioPlanView): ResultDrawerView {
  const diff = view.draftDiff;
  return {
    artifacts: [],
    attachments: [],
    plan: {
      milestones: view.milestones.map(stepOf),
      activity: view.activity.map((entry, i) => ({ id: `activity-${i}`, text: entry.text, at: entry.at })),
    },
    changes: {
      added: diff?.added.map((x) => x.title) ?? [],
      modified: diff?.changed.map((x) => x.title) ?? [],
      removed: diff?.removed.map((x) => x.title) ?? [],
      pendingApproval: Boolean(diff && view.gate?.kind === 'changes' && view.gate.state === 'pending'),
    },
  };
}

/** 一张需要客户动手的卡：问题 > 改动 > 开工 > 交付，用来定位滚动与待办跳转。 */
const ACTIONABLE: ReadonlySet<StudioCard['kind']> = new Set(['question', 'changes', 'start', 'delivery']);

export function requestViewFromPlan(view: StudioPlanView, input: RequestViewInput): RequestView {
  const cards = cardsOf(view, input);
  const summary: RequestSummary = {
    id: view.planRef,
    projectId: input.projectId,
    projectName: input.projectName ?? '',
    title: view.title,
    platform: input.platform ?? 'web',
    ...statusOf(view, input),
    updatedAt: input.updatedAt ?? 0,
  };
  const active = cards.find((card) => ACTIONABLE.has(card.kind));
  return {
    summary,
    messages: view.turns.map(messageOf).filter((message) => message.text.trim().length > 0),
    cards,
    ...(active ? { activeCardId: active.id } : {}),
    results: resultsOf(view),
  };
}
