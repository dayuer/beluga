import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanSummary, PlansRes, ProjectSummary } from '../lib/hub-schema';
import { REQUESTS_CACHE_KEY } from '../lib/requests-source';
import type { RequestSummary } from '../lib/views';

const mockRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
const refreshTodos = vi.fn(async () => {});

const mockState = {
  online: true,
  projects: vi.fn(),
  plans: vi.fn(),
  cache: new Map<string, { value: unknown; fetchedAt: number }>(),
};

vi.mock('./Header', () => ({ Header: () => null }));

vi.mock('./Skeleton', () => ({ Skeleton: () => null }));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'zh' }],
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

vi.mock('lucide-react-native', () => ({
  ChevronDown: () => null,
  ChevronRight: () => null,
}));

vi.mock('../lib/kv', () => ({
  kv: { get: () => undefined, set: () => {}, remove: () => {} },
}));

vi.mock('../lib/cache', () => ({
  cache: {
    get: (key: string) => mockState.cache.get(key),
    set: (key: string, value: unknown, fetchedAt: number) => {
      mockState.cache.set(key, { value, fetchedAt });
    },
  },
}));

vi.mock('../lib/session', () => ({
  session: { clear: vi.fn(), get: () => undefined, token: () => undefined },
}));

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({}),
    // 和真正的 useFocusEffect 一样，挂载后跑一次回调。
    useFocusEffect: (cb: () => void) => {
      useEffect(() => {
        cb();
      }, [cb]);
    },
  };
});

vi.mock('../lib/net', () => ({
  useOnline: () => mockState.online,
}));

vi.mock('../lib/resume', () => ({
  useOnResume: () => {},
}));

vi.mock('../lib/client', () => ({
  isDemoMode: () => false,
  hub: {
    projects: (...args: unknown[]) => mockState.projects(...args),
    plans: (...args: unknown[]) => mockState.plans(...args),
  },
}));

vi.mock('../lib/todo-store', () => ({
  useTodos: () => ({ result: undefined, loading: false, error: null, refresh: refreshTodos }),
}));

import RequestsScreen from '../app/(tabs)/index';
import { DEMO_REQUEST_SUMMARIES } from '../lib/demo';

const PROJECT: ProjectSummary = { id: 'p1', studioId: 's1', studioName: '工作室', name: '优选商城' };

const plan = (over: Partial<PlanSummary> = {}): PlanSummary => ({
  planRef: 'plan-1',
  title: '登录页改版',
  stage: 'running',
  waitingOn: 'studio',
  headline: '正在生成首页',
  progress: { done: 1, total: 3 },
  updatedAt: 1_700_000_000_000,
  ...over,
});

const plansRes = (plans: PlanSummary[]): PlansRes => ({ plans, studio: { online: true, lastSyncAt: null } });

const cachedRequest: RequestSummary = {
  id: 'plan-cached',
  projectId: 'p1',
  projectName: '优选商城',
  title: '缓存里的需求',
  platform: 'web',
  status: 'working',
  statusLine: '正在打样',
  updatedAt: 1_700_000_000_000,
};

const expectNoDemoTitles = (queryByText: (text: string) => unknown) => {
  for (const demo of DEMO_REQUEST_SUMMARIES) {
    expect(queryByText(demo.title), `演示数据「${demo.title}」不应出现`).toBeNull();
  }
};

describe('RequestsScreen（非 DEMO）', () => {
  beforeEach(() => {
    mockState.online = true;
    mockState.cache.clear();
    mockState.projects.mockReset();
    mockState.plans.mockReset();
    refreshTodos.mockClear();
    mockRouter.push.mockClear();
  });

  it('加载中：没有缓存、请求挂起时显示骨架，不显示演示数据', async () => {
    mockState.projects.mockReturnValue(new Promise(() => {}));

    const { getByTestId, queryByTestId, queryByText } = await render(<RequestsScreen />);

    expect(getByTestId('requests-skeleton')).toBeTruthy();
    expect(queryByTestId('requests-empty')).toBeNull();
    expect(queryByTestId('requests-error')).toBeNull();
    expect(queryByTestId('offline-banner')).toBeNull();
    expectNoDemoTitles(queryByText);
  });

  it('空列表：hub 返回项目但没有需求时显示 requests-empty', async () => {
    mockState.projects.mockResolvedValue({ ok: true, value: { projects: [PROJECT] } });
    mockState.plans.mockResolvedValue({ ok: true, value: plansRes([]) });

    const { getByTestId, queryByTestId, queryByText } = await render(<RequestsScreen />);

    await waitFor(() => expect(getByTestId('requests-empty')).toBeTruthy());
    expect(queryByTestId('requests-skeleton')).toBeNull();
    expect(queryByTestId('requests-error')).toBeNull();
    expectNoDemoTitles(queryByText);
  });

  it('失败：无缓存且请求报错时显示 requests-error 和重试按钮，点重试会再拉一次', async () => {
    mockState.projects.mockResolvedValue({ ok: false, error: { kind: 'http' } });

    const { getByTestId, queryByTestId, queryByText } = await render(<RequestsScreen />);

    await waitFor(() => expect(getByTestId('requests-error')).toBeTruthy());
    expect(getByTestId('requests-retry')).toBeTruthy();
    expect(queryByTestId('requests-empty')).toBeNull();
    expectNoDemoTitles(queryByText);

    const calls = mockState.projects.mock.calls.length;
    fireEvent.press(getByTestId('requests-retry'));
    await waitFor(() => expect(mockState.projects.mock.calls.length).toBeGreaterThan(calls));
  });

  it('离线：显示缓存里的需求并挂 offline-banner，不显示演示数据', async () => {
    mockState.online = false;
    mockState.cache.set(REQUESTS_CACHE_KEY, { value: [cachedRequest], fetchedAt: 1_700_000_000_000 });
    mockState.projects.mockResolvedValue({ ok: false, error: { kind: 'offline' } });

    const { getByTestId, queryByTestId, queryByText } = await render(<RequestsScreen />);

    await waitFor(() => expect(getByTestId('offline-banner')).toBeTruthy());
    expect(getByTestId('request-row-plan-cached')).toBeTruthy();
    expect(queryByText(cachedRequest.title)).toBeTruthy();
    expect(queryByTestId('requests-error')).toBeNull();
    expect(queryByTestId('requests-skeleton')).toBeNull();
    expectNoDemoTitles(queryByText);
  });

  it('正常：真实需求按项目分组显示，标题来自 hub 而不是演示数据', async () => {
    mockState.projects.mockResolvedValue({ ok: true, value: { projects: [PROJECT] } });
    mockState.plans.mockResolvedValue({ ok: true, value: plansRes([plan()]) });

    const { getByTestId, queryByText } = await render(<RequestsScreen />);

    await waitFor(() => expect(getByTestId('request-row-plan-1')).toBeTruthy());
    expect(queryByText('登录页改版')).toBeTruthy();
    expect(getByTestId('requests-group-p1')).toBeTruthy();
    expectNoDemoTitles(queryByText);
  });
});
