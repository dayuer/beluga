import type { Circle, SharingView } from './model.js';
import { planBatch } from './model.js';

/**
 * 200 个圈的演示数据（BLG-217 / BLG-218，docs/calm/sharing.md §5）。
 *
 * 只在开发构建里、并且 localStorage 的 `beluga.fork.sharing.demo.v1` 是数字时启用：
 * 页面改读内存里的这一份，setTrust / forget 只改它，不发 IPC。用来测 200 圈下的打开时间、
 * 滚动和「改一行不跳位」，不动真实设置，也不往 daemon 里塞测试数据。生产构建里 demoCount()
 * 永远是 undefined（import.meta.env.DEV 为假）。
 */

export const DEMO_KEY = 'beluga.fork.sharing.demo.v1';

export function demoCount(): number | undefined {
  if (!import.meta.env.DEV) return undefined;
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 2000 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** 确定性随机（mulberry32）：同一个 seed 每次都是同一批圈。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GIVEN = ['mia', 'bob', 'zoe', 'alice', 'chen', 'nora', 'liam', 'yuki', 'omar', 'ines', 'ravi', 'sara', 'tom', 'vera', 'noah', 'lina'];
const FAMILY = ['陈', '默', '李', '雪', '王', '安', '张', '宁', '刘', '然', '赵', '一', '周', '可', '吴', '然'];
const TEAMS = ['design-team', 'launch', 'refunds', 'staging', 'nightly', 'ios', 'web', 'infra', 'growth', 'docs', 'qa', 'ops'];
const KINDS = ['friend', 'friend', 'friend', 'room', 'remembered'] as const;

const pick = <T,>(list: readonly T[], r: number): T => list[Math.floor(r * list.length) % list.length]!;

/** 约 9% 是例外（200 个圈里 18 个），其余跟随默认；名字中英混合。 */
export function demoCircles(n = 200, seed = 7): Circle[] {
  const rand = rng(seed);
  const names = new Set<string>();
  const out: Circle[] = [];
  const exceptions = Math.round(n * 0.09);
  for (let i = 0; i < n; i++) {
    let name = i % 5 === 0 ? `${pick(TEAMS, rand())}-${i + 1}` : i % 3 === 0 ? `${pick(FAMILY, rand())}${pick(FAMILY, rand())}` : pick(GIVEN, rand());
    while (names.has(name)) name = `${name}-${i + 1}`;
    names.add(name);
    const kind = pick(KINDS, rand());
    const pinned = i < exceptions ? (['full', 'trusted', 'blocked'] as const)[i % 3] : undefined;
    out.push({ id: `demo-${i + 1}`, name, kind, ...(pinned ? { pinned } : {}), online: rand() < 0.3 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id));
}

/** 演示用的一份视图：默认「询问我」，和真实数据同样的形状。 */
export function demoView(n = 200, seed = 7): SharingView {
  return { def: 'ask', circles: demoCircles(n, seed) };
}

/** 在内存里执行一次批量改（与真实路径共用 planBatch），返回新的视图。 */
export function demoApply(view: SharingView, ids: readonly string[], to: Parameters<typeof planBatch>[2]): SharingView {
  const plan = planBatch(view, ids, to);
  const set = new Map(plan.set);
  const forget = new Set(plan.forget);
  return {
    ...view,
    circles: view.circles.map((c) => {
      if (set.has(c.id)) return { ...c, pinned: set.get(c.id) };
      if (forget.has(c.id)) {
        const { pinned: _gone, ...rest } = c;
        return rest;
      }
      return c;
    }),
  };
}

/** 演示里改默认（真实路径是 setClaudeSharing）。 */
export function demoDefault(view: SharingView, def: SharingView['def']): SharingView {
  return { ...view, def };
}
