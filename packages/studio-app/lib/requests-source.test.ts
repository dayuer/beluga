import { describe, expect, it, vi } from 'vitest';
import type { PlansRes, ProjectSummary } from './hub-schema';
import {
  loadRequestsFromHub,
  mapProjectsPlansToRequests,
  planToRequestSummary,
  REQUESTS_CACHE_KEY,
  type RequestsCachePort,
} from './requests-source';

function makeCache(): RequestsCachePort {
  const map = new Map<string, { value: unknown; fetchedAt: number }>();
  return {
    get: <T,>(key: string) => map.get(key) as { value: T; fetchedAt: number } | undefined,
    set: (key, value, fetchedAt) => {
      map.set(key, { value, fetchedAt });
    },
  };
}

const PROJ_A: ProjectSummary = {
  id: 'proj-a',
  studioId: 'st-1',
  studioName: '工作室 A',
  name: '优选商城',
};

describe('lib/requests-source', () => {
  it('maps projects + plans into RequestSummary and marks offline runner as waiting', () => {
    const planWorking = {
      planRef: 'p1',
      title: '登录改版',
      stage: 'running' as const,
      waitingOn: 'ai' as const,
      headline: '编写中',
      progress: { done: 1, total: 3 },
      updatedAt: 2_000,
    };
    const planCustomer = {
      ...planWorking,
      planRef: 'p2',
      title: '支付验收',
      stage: 'awaiting-review' as const,
      waitingOn: 'customer' as const,
      headline: '等你验收',
    };
    const planDone = {
      ...planWorking,
      planRef: 'p3',
      title: '首页圆角',
      stage: 'done' as const,
      waitingOn: 'studio' as const,
      headline: '已上线',
    };

    const offlineSummary = planToRequestSummary(PROJ_A, planWorking, false, 'zh');
    expect(offlineSummary.status).toBe('waiting');
    expect(offlineSummary.waitReason).toBe('offline');

    const mapped = mapProjectsPlansToRequests(
      [
        {
          project: PROJ_A,
          plansRes: {
            plans: [planWorking, planCustomer, planDone],
            studio: { online: true, lastSyncAt: 1_000 },
          } satisfies PlansRes,
        },
      ],
      'zh',
    );
    expect(mapped.map((m) => [m.id, m.status])).toEqual([
      ['p1', 'working'],
      ['p2', 'needs-you'],
      ['p3', 'done'],
    ]);
  });

  it('clears session on 401 (signed-out) from projects or plans', async () => {
    const onSignedOut = vi.fn();
    const cache = makeCache();

    const r1 = await loadRequestsFromHub({
      hub: {
        projects: async () => ({ ok: false, error: { kind: 'signed-out' } }),
        plans: async () => ({ ok: false, error: { kind: 'signed-out' } }),
      },
      cache,
      onSignedOut,
      lang: 'zh',
    });
    expect(r1).toEqual({ kind: 'signed-out' });
    expect(onSignedOut).toHaveBeenCalledTimes(1);

    const r2 = await loadRequestsFromHub({
      hub: {
        projects: async () => ({ ok: true, value: { projects: [PROJ_A] } }),
        plans: async () => ({ ok: false, error: { kind: 'signed-out' } }),
      },
      cache,
      onSignedOut,
      lang: 'zh',
    });
    expect(r2).toEqual({ kind: 'signed-out' });
    expect(onSignedOut).toHaveBeenCalledTimes(2);
  });

  it('returns cached items when offline and null items when no cache exists', async () => {
    const cache = makeCache();
    const onSignedOut = vi.fn();

    const firstOffline = await loadRequestsFromHub({
      hub: {
        projects: async () => ({ ok: false, error: { kind: 'offline' } }),
        plans: async () => ({ ok: false, error: { kind: 'offline' } }),
      },
      cache,
      onSignedOut,
      lang: 'zh',
    });
    expect(firstOffline).toEqual({ kind: 'offline', items: null, fetchedAt: 0 });

    cache.set(
      REQUESTS_CACHE_KEY,
      [
        {
          id: 'cached-1',
          projectId: 'proj-a',
          projectName: '优选商城',
          title: '缓存需求',
          platform: 'web',
          status: 'working',
          statusLine: '进行中',
          updatedAt: 5_000,
        },
      ],
      4_000,
    );

    const cachedOffline = await loadRequestsFromHub({
      hub: {
        projects: async () => ({ ok: false, error: { kind: 'offline' } }),
        plans: async () => ({ ok: false, error: { kind: 'offline' } }),
      },
      cache,
      onSignedOut,
      lang: 'zh',
    });
    expect(cachedOffline.kind).toBe('offline');
    if (cachedOffline.kind === 'offline') {
      expect(cachedOffline.items?.map((i) => i.id)).toEqual(['cached-1']);
      expect(cachedOffline.fetchedAt).toBe(4_000);
    }
  });
});
