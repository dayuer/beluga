import { describe, expect, it } from 'vitest';
import {
  filterRequests,
  groupRequestsByProject,
  isNeedsYou,
  needsYouReason,
  sortRequests,
} from './requests';
import type { RequestSummary } from './views';

const BASE = {
  projectId: 'proj-a',
  projectName: '优选商城 App',
  platform: 'ios',
  statusLine: '进行中',
} as const;

type RequestOverrides = {
  id: string;
  projectId?: string;
  projectName?: string;
  title?: string;
  platform?: string;
  status?: RequestSummary['status'];
  statusLine?: string;
  waitReason?: RequestSummary['waitReason'];
  errorAction?: string;
  updatedAt?: number;
  unreadCount?: number;
};

function makeReq(overrides: RequestOverrides): RequestSummary {
  return {
    ...BASE,
    title: `需求 ${overrides.id}`,
    status: 'working',
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('lib/requests', () => {
  it('identifies needs-you items and excludes waiting (offline/queued/quota/needs-human)', () => {
    expect(isNeedsYou(makeReq({ id: '1', status: 'needs-you', statusLine: '等你批准开工' }))).toBe(true);
    expect(isNeedsYou(makeReq({ id: '2', status: 'working' }))).toBe(false);
    expect(isNeedsYou(makeReq({ id: '3', status: 'done' }))).toBe(false);
    expect(isNeedsYou(makeReq({ id: '4', status: 'error' }))).toBe(false);

    for (const waitReason of ['offline', 'queued', 'quota', 'needs-human'] as const) {
      const item = makeReq({ id: `w-${waitReason}`, status: 'waiting', waitReason });
      expect(isNeedsYou(item)).toBe(false);
      expect(needsYouReason(item)).toBeUndefined();
    }

    expect(needsYouReason(makeReq({ id: '1', status: 'needs-you', statusLine: '等你批准开工' }))).toBe(
      '等你批准开工',
    );
  });

  it('pins needs-you items at top sorted by arrival time, and sorts the rest by updatedAt desc', () => {
    const items: RequestSummary[] = [
      makeReq({ id: 'done-new', status: 'done', updatedAt: 9_000 }),
      makeReq({ id: 'wait-offline', status: 'waiting', waitReason: 'offline', updatedAt: 8_000 }),
      makeReq({ id: 'ny-later', status: 'needs-you', statusLine: '等你验收', updatedAt: 3_000 }),
      makeReq({ id: 'working-mid', status: 'working', updatedAt: 5_000 }),
      makeReq({ id: 'ny-earlier', status: 'needs-you', statusLine: '等你批准', updatedAt: 1_000 }),
    ];

    const sorted = sortRequests(items);
    expect(sorted.map((r) => r.id)).toEqual([
      'ny-earlier',
      'ny-later',
      'done-new',
      'wait-offline',
      'working-mid',
    ]);
  });

  it('filters by title or projectName case-insensitively', () => {
    const items: RequestSummary[] = [
      makeReq({ id: '1', projectId: 'p1', projectName: '优选商城 App', title: '登录页改版' }),
      makeReq({ id: '2', projectId: 'p2', projectName: 'Ops Console', title: '订单导出' }),
      makeReq({ id: '3', projectId: 'p3', projectName: '小程序', title: 'SSO Login' }),
    ];

    expect(filterRequests(items, '')).toHaveLength(3);
    expect(filterRequests(items, '  ')).toHaveLength(3);
    expect(filterRequests(items, '登录').map((r) => r.id)).toEqual(['1']);
    expect(filterRequests(items, 'ops').map((r) => r.id)).toEqual(['2']);
    expect(filterRequests(items, 'sso').map((r) => r.id)).toEqual(['3']);
    expect(filterRequests(items, '不存在')).toEqual([]);
  });

  it('groups requests by project, placing projects with needs-you first and sorting within groups', () => {
    const items: RequestSummary[] = [
      makeReq({
        id: 'ops-work',
        projectId: 'proj-ops',
        projectName: '运营后台',
        status: 'working',
        updatedAt: 10_000,
      }),
      makeReq({
        id: 'shop-done',
        projectId: 'proj-shop',
        projectName: '优选商城 App',
        status: 'done',
        updatedAt: 4_000,
      }),
      makeReq({
        id: 'shop-ny',
        projectId: 'proj-shop',
        projectName: '优选商城 App',
        status: 'needs-you',
        statusLine: '等你批准开工',
        updatedAt: 2_000,
      }),
      makeReq({
        id: 'ops-wait',
        projectId: 'proj-ops',
        projectName: '运营后台',
        status: 'waiting',
        waitReason: 'needs-human',
        updatedAt: 9_000,
      }),
    ];

    const groups = groupRequestsByProject(items);
    expect(groups.map((g) => g.projectId)).toEqual(['proj-shop', 'proj-ops']);
    expect(groups[0]!.needsYouCount).toBe(1);
    expect(groups[0]!.items.map((r) => r.id)).toEqual(['shop-ny', 'shop-done']);
    expect(groups[1]!.needsYouCount).toBe(0);
    expect(groups[1]!.items.map((r) => r.id)).toEqual(['ops-work', 'ops-wait']);
  });
});
