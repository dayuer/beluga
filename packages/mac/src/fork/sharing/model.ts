import type { Policy } from '@beluga/core/store.js';
import { defaultTrust, type TrustLevel } from '@beluga/core/trust.js';

/**
 * 「我的共享」的纯模型（BLG-217 / BLG-218，docs/calm/sharing.md）：「一个默认 + 少数例外」。
 * 不碰 React、不碰页面，测试可以只灌一个状态进来（tests/sharing-defaults.test.ts）。
 *
 * 数据语义与 core/trust.ts 的 trustOf 相同：
 *   实际级别 = 逐人设置(levels 或 remembered) ?? 所有圈默认(policy 映射)。
 * 「圈」是好友、房间里的人和记住的人；guest 的权限由邀请链接决定，不在这里。
 */

export type Level = TrustLevel;

/** 一个默认能用的级别：'full' 永远是例外，不能当作所有圈的默认。 */
export type DefaultLevel = Exclude<Level, 'full'>;

export type CircleKind = 'friend' | 'room' | 'remembered';

export interface Circle {
  readonly id: string;
  readonly name: string;
  readonly kind: CircleKind;
  /** 单独设过的级别；undefined 表示跟随默认。 */
  readonly pinned?: Level;
  readonly online?: boolean;
}

export interface SharingView {
  /** 所有圈默认（policy 映射后的级别）。 */
  readonly def: Level;
  /** 按名字排好；名字相同按 id 排，顺序稳定。 */
  readonly circles: readonly Circle[];
}

/** sharingOf 需要的状态（AppState 满足它；测试可以只给这些字段）。 */
export interface SharingState {
  readonly policy: Policy;
  readonly levels: Readonly<Record<string, Level>>;
  readonly remembered: Readonly<Record<string, { readonly name: string; readonly trust: Level }>>;
  readonly peers: readonly { readonly peerId: string; readonly name: string; readonly guest?: boolean }[];
  readonly selfId: string;
  readonly guests: Readonly<Record<string, unknown>>;
  readonly network: { readonly friends: readonly { readonly peerId: string; readonly name: string; readonly online?: boolean }[] };
}

export const ALL_LEVELS: readonly Level[] = ['blocked', 'ask', 'trusted', 'full'];

/** 页面「所有圈默认」只给这三种；'full' 只能单独给某个圈。 */
export const DEFAULT_LEVELS: readonly DefaultLevel[] = ['ask', 'trusted', 'blocked'];

/** 默认级别回到 policy（setClaudeSharing 的参数）。 */
export const POLICY_OF: Readonly<Record<DefaultLevel, Policy>> = { ask: 'ask', trusted: 'auto', blocked: 'deny' };

/** 与 policy 一一对应的级别（'full' 不会出现）。 */
export const levelOfPolicy = (policy: Policy): DefaultLevel => defaultTrust({ policy }) as DefaultLevel;

/** 这个名字在页面上的顺序：只按名字，不按级别。 */
const byName = (a: Circle, b: Circle): number => a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id);

const norm = (text: string): string => text.normalize('NFKC').toLowerCase();

const KIND_RANK: Readonly<Record<CircleKind, number>> = { friend: 3, room: 2, remembered: 1 };

/**
 * 好友 ∪ 房间里的人（去掉自己和 guest）∪ 记住的人，按 id 去重。
 * 同一个人既在房间又是好友时算好友（名字与在线状态取好友的）。
 */
export function sharingOf(state: SharingState): SharingView {
  const found = new Map<string, Circle>();
  const add = (id: string, name: string, kind: CircleKind, online?: boolean): void => {
    if (!id || id === state.selfId || id in state.guests) return;
    const pinned = state.levels[id] ?? state.remembered[id]?.trust;
    const before = found.get(id);
    if (before && KIND_RANK[before.kind] >= KIND_RANK[kind]) {
      if (online !== undefined && before.online !== online) found.set(id, { ...before, online });
      return;
    }
    found.set(id, { id, name, kind, ...(pinned !== undefined ? { pinned } : {}), ...(online !== undefined ? { online } : {}) });
  };
  for (const f of state.network.friends) add(f.peerId, f.name, 'friend', f.online);
  // Guests came with an invite link: what they may do was decided then, not here.
  for (const p of state.peers) if (!p.guest) add(p.peerId, p.name, 'room', true);
  for (const [id, r] of Object.entries(state.remembered)) add(id, r.name, 'remembered', false);
  return { def: levelOfPolicy(state.policy), circles: [...found.values()].sort(byName) };
}

/** 这个圈实际用的级别。 */
export const effective = (c: Circle, def: Level): Level => c.pinned ?? def;

/** 它和默认不同吗（只有这种圈会出现在「例外」里）。 */
export const isException = (c: Circle, def: Level): boolean => c.pinned !== undefined && c.pinned !== def;

/** 逐人设置恰好等于默认的人：迁移时 forget 掉，实际结果按构造不变。 */
export function redundantPins(view: SharingView): string[] {
  return view.circles.filter((c) => c.pinned !== undefined && c.pinned === view.def).map((c) => c.id);
}

/** 页面打开时（以及改默认前）要做的迁移：不改 policy，只去掉与默认相同的逐人设置。 */
export function migrate(state: SharingState): { drop: string[] } {
  return { drop: redundantPins(sharingOf(state)) };
}

export type FilterShow = 'all' | 'exceptions' | Level;

export interface Filter {
  readonly q: string;
  readonly show: FilterShow;
}

/** 搜索（NFKC + 小写包含）与筛选；不改变排序。 */
export function filterCircles(view: SharingView, filter: Filter): Circle[] {
  const q = norm(filter.q.trim());
  const byQuery = q ? view.circles.filter((c) => norm(c.name).includes(q)) : [...view.circles];
  if (filter.show === 'all') return byQuery;
  if (filter.show === 'exceptions') return byQuery.filter((c) => isException(c, view.def));
  return byQuery.filter((c) => effective(c, view.def) === filter.show);
}

export interface BatchPlan {
  /** setTrust 的人与目标级别。 */
  readonly set: readonly (readonly [string, Level])[];
  /** forget 的人（回到默认）。 */
  readonly forget: readonly string[];
  /** 已经就是目标的人：不用调。 */
  readonly unchanged: number;
}

/**
 * 批量改的计划，按 circles 的顺序（确定性）。'default' = 回到默认。
 * 设成与默认相同的级别不算例外，按「不变」处理，避免制造一条与默认相同的逐人设置。
 */
export function planBatch(view: SharingView, ids: readonly string[], to: Level | 'default'): BatchPlan {
  const wanted = new Set(ids);
  const set: [string, Level][] = [];
  const forget: string[] = [];
  let unchanged = 0;
  for (const c of view.circles) {
    if (!wanted.has(c.id)) continue;
    if (to === 'default') {
      if (c.pinned === undefined) unchanged++;
      else forget.push(c.id);
      continue;
    }
    if (c.pinned === to || (c.pinned === undefined && view.def === to)) unchanged++;
    else set.push([c.id, to]);
  }
  return { set, forget, unchanged };
}
