import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioPlanView } from '../../../src/studio/protocol';

const mockState = {
  plan: vi.fn(),
  plans: vi.fn(),
  send: vi.fn(),
};

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-linking', () => ({ openURL: vi.fn() }));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
vi.mock('../lib/haptics', () => ({
  haptics: { select: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../lib/viewport', () => ({ useKeyboardInset: () => 0 }));
vi.mock('../lib/design-upload', () => ({
  useDesignUpload: () => ({ uploader: { start: vi.fn(), machine: { getState: () => null } }, info: null }),
}));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../lib/cache', () => ({
  cache: { get: () => undefined, set: () => {}, remove: () => {} },
}));
vi.mock('../lib/session', () => ({
  session: { clear: vi.fn(), get: () => undefined, token: () => undefined },
}));
vi.mock('../lib/net', () => ({
  useOnline: () => true,
  isOnline: () => true,
  subscribeOnline: () => () => {},
}));
vi.mock('../lib/resume', () => ({ useOnResume: () => {}, onResume: () => () => {} }));
vi.mock('../lib/keys', () => ({
  DeviceKeyMissingError: class DeviceKeyMissingError extends Error {},
  useHasDeviceKey: () => ({ hasKey: true, loading: false, refresh: vi.fn() }),
}));
vi.mock('../lib/signed', () => ({ signFrame: vi.fn(async () => ({ at: 0, deviceKey: 'k', kind: 'chat.send', payload: {} })) }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'plan1', project: 'p1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./UndoBar', () => ({ UndoBar: () => null }));

vi.mock('../lib/client', () => ({
  isDemoMode: () => false,
  hub: {
    plan: (...args: unknown[]) => mockState.plan(...args),
    plans: (...args: unknown[]) => mockState.plans(...args),
    send: (...args: unknown[]) => mockState.send(...args),
  },
  live: { subscribe: () => () => {} },
}));

import RequestDetailScreen from '../app/request/[id]';
import { undoStore } from '../lib/undo';

const PLAN: StudioPlanView = {
  planRef: 'plan1',
  draftRev: 2,
  title: '登录页改版',
  goal: '按新设计稿改登录页',
  stage: 'running',
  waitingOn: 'ai',
  headline: '在做：里程碑 m1，已完成 1 项，共 2 项',
  progress: { done: 1, total: 2 },
  milestones: [
    { ref: 'm0', title: '改登录表单', criteria: [], status: 'passed', tasks: [] },
    { ref: 'm1', title: '加一键登录', criteria: [], status: 'working', tasks: [] },
  ],
  decisions: [],
  turns: [
    { id: 't1', who: 'customer', text: '帮我改登录页，加一键登录', at: 1_700_000_000_000 },
    { id: 't2', who: 'ai', text: '收到，先改表单再加一键登录', at: 1_700_000_001_000 },
  ],
  typing: false,
  moreTurns: false,
  activity: [],
};

describe('需求详情（非 DEMO，SS-223）', () => {
  beforeEach(() => {
    mockState.plan.mockReset();
    mockState.plans.mockReset();
    mockState.send.mockReset();
    mockState.plan.mockResolvedValue({ ok: true, value: { view: PLAN, updatedAt: 5_000 } });
    mockState.plans.mockResolvedValue({
      ok: true,
      value: { plans: [], studio: { online: true, lastSyncAt: null } },
    });
    mockState.send.mockImplementation(async (_pid: string, action: { opId: string }) => ({
      ok: true,
      value: { t: 'receipt', opId: action.opId, state: 'done', planRef: 'plan1' },
    }));
  });

  it('问题卡点「就这样」按建议答案发 decision.answer', async () => {
    const withDecision: StudioPlanView = {
      ...PLAN,
      waitingOn: 'customer',
      decisions: [
        {
          decisionId: 'd1',
          question: '提醒要做成每天几次？',
          options: [
            { id: 'o0', label: '每天两次' },
            { id: 'o1', label: '每天一次' },
          ],
          multi: false,
          open: true,
        },
      ],
    };
    mockState.plan.mockResolvedValue({ ok: true, value: { view: withDecision, updatedAt: 5_000 } });

    const screen = await render(<RequestDetailScreen />);
    await waitFor(() => expect(screen.getByText('我先按：每天两次')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('questions-submit'));
    await act(async () => {
      undoStore.flush();
    });

    await waitFor(() => expect(mockState.send).toHaveBeenCalledTimes(1));
    const [pid, action] = mockState.send.mock.calls[0] as [
      string,
      { kind: string; planRef: string; payload: { decisionId: string; picks?: readonly string[] } },
    ];
    expect(pid).toBe('p1');
    expect(action.kind).toBe('decision.answer');
    expect(action.planRef).toBe('plan1');
    expect(action.payload).toEqual({ decisionId: 'd1', picks: ['o0'] });
    // 答过的问题本地先标为已答，卡片从流里收走
    await waitFor(() => expect(screen.queryByTestId('questions-submit')).toBeNull());
  });

  it('从 hub 拉真实计划：状态行、步骤卡与对话都显示，不出演示数据', async () => {
    const screen = await render(<RequestDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('card-steps')).toBeTruthy());
    expect(screen.getByText('在做：里程碑 m1，已完成 1 项，共 2 项')).toBeTruthy();
    expect(screen.getByText('帮我改登录页，加一键登录')).toBeTruthy();
    expect(screen.getByText('收到，先改表单再加一键登录')).toBeTruthy();
    expect(screen.queryByTestId('request-empty')).toBeNull();
    expect(screen.queryByText('登录页改版与一键登录')).toBeNull();
    expect(mockState.plan).toHaveBeenCalledWith('p1', 'plan1');
  });

  it('发消息走 chat.send：本地气泡先出现，hub 收到带文本的动作', async () => {
    const screen = await render(<RequestDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('card-steps')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('request-chat-input'), '把按钮改成蓝色');
    await fireEvent.press(screen.getByTestId('request-chat-send'));

    await waitFor(() => expect(mockState.send).toHaveBeenCalledTimes(1));
    const [pid, action] = mockState.send.mock.calls[0] as [string, { kind: string; planRef: string; payload: { text: string } }];
    expect(pid).toBe('p1');
    expect(action.kind).toBe('chat.send');
    expect(action.planRef).toBe('plan1');
    expect(action.payload.text).toBe('把按钮改成蓝色');
    expect(screen.getByText('把按钮改成蓝色')).toBeTruthy();
  });

  it('可以连续发多条消息，每条有自己的 opId', async () => {
    const screen = await render(<RequestDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('card-steps')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('request-chat-input'), '第一句');
    await fireEvent.press(screen.getByTestId('request-chat-send'));
    await waitFor(() => expect(mockState.send).toHaveBeenCalledTimes(1));

    await fireEvent.changeText(screen.getByTestId('request-chat-input'), '第二句');
    await fireEvent.press(screen.getByTestId('request-chat-send'));
    await waitFor(() => expect(mockState.send).toHaveBeenCalledTimes(2));

    const [, first] = mockState.send.mock.calls[0] as [string, { opId: string }];
    const [, second] = mockState.send.mock.calls[1] as [string, { opId: string }];
    expect(first.opId).not.toBe(second.opId);
    expect(screen.getByText('第一句')).toBeTruthy();
    expect(screen.getByText('第二句')).toBeTruthy();
  });

  it('发失败时写明没发出去，点重试用同一个 opId 再发一次', async () => {
    let offline = true;
    mockState.send.mockImplementation(async (_pid: string, action: { opId: string }) =>
      offline
        ? { ok: false, error: { kind: 'offline' } }
        : { ok: true, value: { t: 'receipt', opId: action.opId, state: 'done', planRef: 'plan1' } },
    );

    const screen = await render(<RequestDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('card-steps')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('request-chat-input'), '断网也要留住');
    await fireEvent.press(screen.getByTestId('request-chat-send'));

    await waitFor(() => expect(screen.getByTestId('request-chat-retry')).toBeTruthy());
    const [, failed] = mockState.send.mock.calls[0] as [string, { opId: string }];
    // 断网时一次失败会原地补发一次，仍失败才显示重试
    expect(mockState.send).toHaveBeenCalledTimes(2);

    offline = false;
    const before = mockState.send.mock.calls.length;
    await fireEvent.press(screen.getByTestId('request-chat-retry'));
    await waitFor(() => expect(mockState.send.mock.calls.length).toBeGreaterThan(before));
    const [, retried] = mockState.send.mock.calls[before] as [string, { opId: string }];
    expect(retried.opId).toBe(failed.opId);
    await waitFor(() => expect(screen.queryByTestId('request-chat-retry')).toBeNull());
  });
});
