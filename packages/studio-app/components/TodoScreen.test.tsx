import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = {
  online: true,
  todosResult: { todos: [], byProject: {}, fetchedAt: 1000, failed: 0 } as
    | { todos: never[]; byProject: Record<string, number>; fetchedAt: number; failed: number }
    | undefined,
  loading: false,
  error: null as string | null,
};

vi.mock('./Header', () => ({
  Header: () => null,
}));

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

vi.mock('../lib/kv', () => ({
  kv: { get: () => undefined, set: () => {}, remove: () => {} },
}));

vi.mock('../lib/cache', () => ({
  cache: { get: () => undefined, set: () => {} },
}));

vi.mock('../lib/session', () => ({
  session: { clear: vi.fn(), get: () => undefined, token: () => undefined },
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useFocusEffect: () => {},
}));

vi.mock('../lib/net', () => ({
  useOnline: () => mockState.online,
}));

vi.mock('../lib/resume', () => ({
  useOnResume: () => {},
}));

vi.mock('../lib/client', () => ({
  isDemoMode: () => false,
  hub: {
    projects: vi.fn(async () => ({ ok: true, value: { projects: [] } })),
    plans: vi.fn(async () => ({ ok: true, value: { plans: [], studio: { online: true, lastSyncAt: null } } })),
  },
}));

vi.mock('../lib/todo-store', () => ({
  useTodos: () => ({
    result: mockState.todosResult,
    loading: mockState.loading,
    error: mockState.error,
    refresh: vi.fn(async () => {}),
  }),
}));

import TodoScreen from '../app/(tabs)/todo';

describe('TodoScreen (non-DEMO)', () => {
  beforeEach(() => {
    mockState.online = true;
    mockState.todosResult = { todos: [], byProject: {}, fetchedAt: 1000, failed: 0 };
    mockState.loading = false;
    mockState.error = null;
  });

  it('shows todo-empty when non-DEMO has no todos and no waiting requests', async () => {
    const { getByTestId, queryByTestId } = await render(<TodoScreen />);
    expect(getByTestId('todo-empty')).toBeTruthy();
    expect(queryByTestId('todo-waiting-group')).toBeNull();
  });

  it('shows offline SyncBanner even on first offline load with no result', async () => {
    mockState.online = false;
    mockState.todosResult = undefined;
    mockState.error = 'offline';

    const { getByTestId } = await render(<TodoScreen />);
    expect(getByTestId('offline-banner')).toBeTruthy();
  });
});
