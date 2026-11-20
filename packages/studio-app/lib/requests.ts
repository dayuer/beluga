import type { RequestSummary } from './views';

export interface RequestProjectGroup {
  readonly projectId: string;
  readonly projectName: string;
  readonly needsYouCount: number;
  readonly items: readonly RequestSummary[];
}

/**
 * 判断一条需求是否处于「等你」状态。
 * 明确排除 `waiting`（offline/queued/quota/needs-human）等等待态。
 */
export function isNeedsYou(item: RequestSummary): boolean {
  return item.status === 'needs-you';
}

/** 返回「等你」项的原因文案；非「等你」项返回 undefined。 */
export function needsYouReason(item: RequestSummary): string | undefined {
  if (!isNeedsYou(item)) return undefined;
  return item.statusLine;
}

/** 按标题与项目名过滤需求（忽略大小写与首尾空白）。 */
export function filterRequests(
  items: readonly RequestSummary[],
  query: string,
): RequestSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.projectName.toLowerCase().includes(q),
  );
}

/**
 * 排序需求列表：
 * 1. 「等你」置顶，同为「等你」按到达时间（updatedAt 升序，先到先处理）；
 * 2. 其余按更新时间倒序（updatedAt 降序）。
 */
export function sortRequests(items: readonly RequestSummary[]): RequestSummary[] {
  return [...items].sort((a, b) => {
    const aNy = isNeedsYou(a);
    const bNy = isNeedsYou(b);
    if (aNy !== bNy) return aNy ? -1 : 1;
    if (aNy && bNy) {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
      return a.id.localeCompare(b.id);
    }
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id.localeCompare(b.id);
  });
}

/**
 * 按项目分组，每组内复用 `sortRequests` 排序；
 * 含「等你」需求的项目排在前面（按最早到达时间升序），其余项目按最新更新时间倒序。
 */
export function groupRequestsByProject(
  items: readonly RequestSummary[],
): RequestProjectGroup[] {
  const buckets = new Map<string, { projectName: string; list: RequestSummary[] }>();
  for (const item of items) {
    const existing = buckets.get(item.projectId);
    if (existing) {
      existing.list.push(item);
    } else {
      buckets.set(item.projectId, { projectName: item.projectName, list: [item] });
    }
  }

  const groups: RequestProjectGroup[] = [];
  for (const [projectId, { projectName, list }] of buckets) {
    const sorted = sortRequests(list);
    const needsYouCount = sorted.filter(isNeedsYou).length;
    groups.push({ projectId, projectName, needsYouCount, items: sorted });
  }

  return groups.sort((a, b) => {
    const aHas = a.needsYouCount > 0;
    const bHas = b.needsYouCount > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas) {
      const aFirst = a.items[0]?.updatedAt ?? 0;
      const bFirst = b.items[0]?.updatedAt ?? 0;
      if (aFirst !== bFirst) return aFirst - bFirst;
    }
    const aLatest = Math.max(...a.items.map((r) => r.updatedAt));
    const bLatest = Math.max(...b.items.map((r) => r.updatedAt));
    if (aLatest !== bLatest) return bLatest - aLatest;
    return a.projectId.localeCompare(b.projectId);
  });
}
