import { describe, expect, it } from 'vitest';
import type { Policy } from '../src/core/store.js';
import { defaultTrust, trustOf, type TrustLevel } from '../src/core/trust.js';
import {
  ALL_LEVELS,
  DEFAULT_LEVELS,
  POLICY_OF,
  type Circle,
  type Level,
  type SharingState,
  type SharingView,
  effective,
  filterCircles,
  isException,
  levelOfPolicy,
  migrate,
  planBatch,
  redundantPins,
  sharingOf,
} from '../packages/mac/src/fork/sharing/model.js';

/** 「我的共享」的模型（M7，docs/calm/sharing.md §4）：迁移不变、搜索/筛选/排序、批量计划。 */

const POLICIES: readonly Policy[] = ['ask', 'auto', 'deny'];
const LEVELS: readonly Level[] = ['blocked', 'ask', 'trusted', 'full'];

/** 确定性随机（mulberry32），失败可复现。 */
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

const pick = <T,>(list: readonly T[], r: number): T => list[Math.floor(r * list.length) % list.length]!;

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `peer-${i + 1}`);

/** 一个随机的旧状态：policy × levels × remembered × friends × peers × guests × 自己。 */
function randomState(rand: () => number): { state: SharingState; all: string[] } {
  const all = ids(1 + Math.floor(rand() * 12));
  const selfId = 'self';
  const policy = pick(POLICIES, rand());
  const levels: Record<string, Level> = {};
  const remembered: Record<string, { name: string; trust: Level }> = {};
  const peers: { peerId: string; name: string; guest?: boolean }[] = [];
  const friends: { peerId: string; name: string; online?: boolean }[] = [];
  const guests: Record<string, unknown> = {};
  for (const id of all) {
    const roll = rand();
    if (roll < 0.42) levels[id] = pick(LEVELS, rand());
    if (rand() < 0.55) remembered[id] = { name: `Name ${id}`, trust: pick(LEVELS, rand()) };
    if (roll < 0.4) peers.push({ peerId: id, name: `Name ${id}`, ...(rand() < 0.15 ? { guest: true } : {}) });
    if (rand() < 0.3) friends.push({ peerId: id, name: `Name ${id}`, online: rand() < 0.5 });
    if (rand() < 0.08) guests[id] = { can: 'ask' };
  }
  return { state: { policy, levels, remembered, peers, selfId, guests, network: { friends } }, all: [...all, selfId] };
}

/** 迁移在真实路径上做的事：对这些 id 逐个 forget（levels 与 remembered 都去掉）。 */
function afterForget(state: SharingState, drop: readonly string[]): SharingState {
  const levels = { ...state.levels };
  const remembered = { ...state.remembered };
  for (const id of drop) {
    delete levels[id];
    delete remembered[id];
  }
  return { ...state, levels, remembered };
}

/** trustOf 看的是 `self.peerId`；状态里只有 selfId。 */
const trust = (state: SharingState, id: string): TrustLevel =>
  trustOf({ policy: state.policy, levels: state.levels, remembered: state.remembered, self: { peerId: state.selfId } } as never, id);

describe('migration keeps every circle’s real level', () => {
  it('500 random old states: trustOf is the same before and after', () => {
    const rand = rng(20261113);
    for (let round = 0; round < 500; round++) {
      const { state, all } = randomState(rand);
      const drop = migrate(state).drop;
      const next = afterForget(state, drop);
      for (const id of all) {
        expect(trust(next, id), `round ${round}, ${id}`).toBe(trust(state, id));
      }
      // Only settings that already equal the default go.
      const def = levelOfPolicy(state.policy);
      for (const id of drop) expect(trust(state, id)).toBe(def);
      // Running it again drops nothing.
      expect(migrate(next).drop).toEqual([]);
    }
  });

  it('redundantPins is exactly pinned === default', () => {
    const view: SharingView = {
      def: 'ask',
      circles: [
        { id: 'a', name: 'a', kind: 'friend', pinned: 'ask' },
        { id: 'b', name: 'b', kind: 'friend', pinned: 'trusted' },
        { id: 'c', name: 'c', kind: 'room' },
      ],
    };
    expect(redundantPins(view)).toEqual(['a']);
  });
});

describe('sharingOf', () => {
  const state: SharingState = {
    policy: 'ask',
    levels: { bob: 'trusted', self: 'full' },
    remembered: { bob: { name: 'bob (old)', trust: 'blocked' }, mia: { name: 'mia', trust: 'full' } },
    peers: [
      { peerId: 'bob', name: 'bob' },
      { peerId: 'zoe', name: 'zoe' },
      { peerId: 'guest-1', name: 'guest', guest: true },
    ],
    selfId: 'self',
    guests: { 'guest-2': {} },
    network: { friends: [{ peerId: 'mia', name: 'mia', online: true }, { peerId: 'bob', name: 'bob', online: true }] },
  };

  it('merges friends, room and remembered once each; drops self and guests', () => {
    const view = sharingOf(state);
    expect(view.circles.map((c) => [c.id, c.kind])).toEqual([
      ['bob', 'friend'],
      ['mia', 'friend'],
      ['zoe', 'room'],
    ]);
  });

  it('reads the level from levels first, then remembered, else the default', () => {
    const view = sharingOf(state);
    const by = (id: string): Circle => view.circles.find((c) => c.id === id)!;
    expect(by('bob').pinned).toBe('trusted'); // levels wins over remembered
    expect(by('mia').pinned).toBe('full');
    expect(by('zoe').pinned).toBeUndefined();
    expect(effective(by('zoe'), view.def)).toBe('ask');
  });

  it('sorts by name only (zh), stable by id', () => {
    const view = sharingOf({ ...state, peers: [{ peerId: 'p2', name: '陈默' }, { peerId: 'p1', name: '陈默' }, { peerId: 'p3', name: 'alice' }], levels: {}, remembered: {}, network: { friends: [] } });
    // Same name: id decides; the whole list is exactly a localeCompare('zh') sort of the names.
    expect(view.circles.map((c) => c.name)).toEqual([...view.circles.map((c) => c.name)].sort((a, b) => a.localeCompare(b, 'zh')));
    expect(view.circles.filter((c) => c.name === '陈默').map((c) => c.id)).toEqual(['p1', 'p2']);
  });
});

describe('filterCircles', () => {
  const view: SharingView = {
    def: 'ask',
    circles: [
      { id: '1', name: 'Alice', kind: 'friend' },
      { id: '2', name: 'bob', kind: 'friend', pinned: 'trusted' },
      { id: '3', name: '陈默', kind: 'room', pinned: 'ask' },
      { id: '4', name: 'Mia', kind: 'friend', pinned: 'full' },
      { id: '5', name: 'zoe', kind: 'remembered', pinned: 'blocked' },
    ],
  };

  it('searches by name, NFKC and lower case, keeping the order', () => {
    expect(filterCircles(view, { q: 'MI', show: 'all' }).map((c) => c.id)).toEqual(['4']);
    expect(filterCircles(view, { q: '陈', show: 'all' }).map((c) => c.id)).toEqual(['3']);
    expect(filterCircles(view, { q: '  alice ', show: 'all' }).map((c) => c.id)).toEqual(['1']);
    expect(filterCircles(view, { q: 'nope', show: 'all' })).toEqual([]);
  });

  it('shows only the circles that differ from the default', () => {
    expect(filterCircles(view, { q: '', show: 'exceptions' }).map((c) => c.id)).toEqual(['2', '4', '5']);
  });

  it('filters by the level a circle really uses', () => {
    expect(filterCircles(view, { q: '', show: 'ask' }).map((c) => c.id)).toEqual(['1', '3']);
    expect(filterCircles(view, { q: '', show: 'full' }).map((c) => c.id)).toEqual(['4']);
    expect(isException(view.circles[2]!, view.def)).toBe(false);
  });
});

describe('planBatch', () => {
  const view: SharingView = {
    def: 'ask',
    circles: [
      { id: 'a', name: 'a', kind: 'friend' },
      { id: 'b', name: 'b', kind: 'friend', pinned: 'trusted' },
      { id: 'c', name: 'c', kind: 'room', pinned: 'ask' },
      { id: 'd', name: 'd', kind: 'remembered', pinned: 'full' },
    ],
  };

  it('sets only what changes; one already at the target stays', () => {
    const plan = planBatch(view, ['a', 'b', 'c', 'd'], 'trusted');
    expect(plan.set).toEqual([
      ['a', 'trusted'],
      ['c', 'trusted'],
      ['d', 'trusted'],
    ]);
    expect(plan.forget).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('going to the default forgets pins and leaves followers alone', () => {
    const plan = planBatch(view, ['a', 'b', 'c', 'd'], 'default');
    expect(plan.set).toEqual([]);
    expect(plan.forget).toEqual(['b', 'c', 'd']);
    expect(plan.unchanged).toBe(1);
  });

  it('setting someone to the default level is no change at all (no redundant pin)', () => {
    const plan = planBatch(view, ['a', 'c'], 'ask');
    expect(plan.set).toEqual([]);
    expect(plan.forget).toEqual([]);
    expect(plan.unchanged).toBe(2);
  });

  it('ignores ids that are not circles', () => {
    const plan = planBatch(view, ['a', 'ghost'], 'full');
    expect(plan.set).toEqual([['a', 'full']]);
    expect(plan.forget).toEqual([]);
  });
});

describe('the default can never be full trust', () => {
  it('maps only ask / trusted / blocked, and defaultTrust never says full', () => {
    expect(Object.keys(POLICY_OF).sort()).toEqual([...DEFAULT_LEVELS].sort());
    expect(DEFAULT_LEVELS).not.toContain('full');
    for (const policy of POLICIES) {
      expect(levelOfPolicy(policy)).not.toBe('full');
      expect(levelOfPolicy(policy)).toBe(defaultTrust({ policy }) as TrustLevel);
    }
    expect(ALL_LEVELS).toContain('full');
  });
});
