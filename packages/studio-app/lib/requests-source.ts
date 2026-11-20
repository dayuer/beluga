import type { PlanSummary, PlansRes, ProjectSummary } from './hub-schema.js';
import type { Lang } from './strings/table.js';
import type { RequestSummary } from './views.js';

export interface ProjectPlansEntry {
  readonly project: ProjectSummary;
  readonly plansRes?: PlansRes;
}

/**
 * 把单个项目下的 PlanSummary 映射成跨项目需求列表项 `RequestSummary`。
 * 当执行机器离线（`studioOnline === false`）且未完成、非等你处理时，映射为 `waiting`（灰色）。
 */
export function planToRequestSummary(
  project: ProjectSummary,
  plan: PlanSummary,
  studioOnline: boolean,
  lang: Lang,
): RequestSummary {
  if (plan.stage === 'done') {
    return {
      id: plan.planRef,
      projectId: project.id,
      projectName: project.name,
      title: plan.title,
      platform: 'web',
      status: 'done',
      statusLine: plan.headline,
      updatedAt: plan.updatedAt,
    };
  }

  if (plan.waitingOn === 'customer') {
    return {
      id: plan.planRef,
      projectId: project.id,
      projectName: project.name,
      title: plan.title,
      platform: 'web',
      status: 'needs-you',
      statusLine: plan.headline,
      updatedAt: plan.updatedAt,
    };
  }

  if (!studioOnline) {
    return {
      id: plan.planRef,
      projectId: project.id,
      projectName: project.name,
      title: plan.title,
      platform: 'web',
      status: 'waiting',
      waitReason: 'offline',
      statusLine:
        lang === 'en' ? 'Waiting: runner is offline' : '等待：执行机器暂时离线',
      updatedAt: plan.updatedAt,
    };
  }

  if (plan.waitingOn === 'studio') {
    return {
      id: plan.planRef,
      projectId: project.id,
      projectName: project.name,
      title: plan.title,
      platform: 'web',
      status: 'waiting',
      waitReason: 'queued',
      statusLine: plan.headline,
      updatedAt: plan.updatedAt,
    };
  }

  return {
    id: plan.planRef,
    projectId: project.id,
    projectName: project.name,
    title: plan.title,
    platform: 'web',
    status: 'working',
    statusLine: plan.headline,
    updatedAt: plan.updatedAt,
  };
}

/** 把多个项目的 `PlansRes` 映射成扁平的 `RequestSummary[]`。 */
export function mapProjectsPlansToRequests(
  entries: readonly ProjectPlansEntry[],
  lang: Lang,
): RequestSummary[] {
  const out: RequestSummary[] = [];
  for (const { project, plansRes } of entries) {
    if (!plansRes) continue;
    for (const plan of plansRes.plans) {
      out.push(planToRequestSummary(project, plan, plansRes.studio.online, lang));
    }
  }
  return out;
}

export type HubErrKind = 'offline' | 'signed-out' | 'http' | 'bad-json' | 'denied' | string;

export type HubResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly kind: HubErrKind } };

export interface RequestsHubPort {
  projects(): Promise<HubResult<{ readonly projects: readonly ProjectSummary[] }>>;
  plans(pid: string): Promise<HubResult<PlansRes>>;
}

export interface RequestsCachePort {
  get<T>(key: string): { readonly value: T; readonly fetchedAt: number } | undefined;
  set<T>(key: string, value: T, fetchedAt: number): void;
}

export const REQUESTS_CACHE_KEY = 'requests:summaries';

export type LoadRequestsOutcome =
  | { readonly kind: 'ok'; readonly items: readonly RequestSummary[]; readonly fetchedAt: number }
  | { readonly kind: 'signed-out' }
  | {
      readonly kind: 'offline' | 'error';
      readonly items: readonly RequestSummary[] | null;
      readonly fetchedAt: number;
    };

/**
 * 拉取真实跨项目需求列表：
 * - 遇到 `signed-out`（401）立即调用 `onSignedOut()` 清空会话；
 * - 失败或离线时优先保留缓存；无缓存时返回 `items: null`。
 */
export async function loadRequestsFromHub({
  hub,
  cache,
  onSignedOut,
  lang,
  now = Date.now,
}: {
  readonly hub: RequestsHubPort;
  readonly cache: RequestsCachePort;
  readonly onSignedOut: () => void;
  readonly lang: Lang;
  readonly now?: () => number;
}): Promise<LoadRequestsOutcome> {
  const cachedSummary = cache.get<RequestSummary[]>(REQUESTS_CACHE_KEY);
  const projectsRes = await hub.projects();
  if (!projectsRes.ok) {
    if (projectsRes.error.kind === 'signed-out') {
      onSignedOut();
      return { kind: 'signed-out' };
    }
    return {
      kind: projectsRes.error.kind === 'offline' ? 'offline' : 'error',
      items: cachedSummary?.value ?? null,
      fetchedAt: cachedSummary?.fetchedAt ?? 0,
    };
  }

  const entries: ProjectPlansEntry[] = [];
  for (const project of projectsRes.value.projects) {
    const plansRes = await hub.plans(project.id);
    if (plansRes.ok) {
      cache.set(`plans:${project.id}`, plansRes.value, now());
      entries.push({ project, plansRes: plansRes.value });
      continue;
    }
    if (plansRes.error.kind === 'signed-out') {
      onSignedOut();
      return { kind: 'signed-out' };
    }
    const cachedPlans = cache.get<PlansRes>(`plans:${project.id}`);
    entries.push({ project, plansRes: cachedPlans?.value });
  }

  const items = mapProjectsPlansToRequests(entries, lang);
  const at = now();
  cache.set(REQUESTS_CACHE_KEY, items, at);
  return { kind: 'ok', items, fetchedAt: at };
}
