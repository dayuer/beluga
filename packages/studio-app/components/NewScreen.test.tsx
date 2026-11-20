import { fireEvent, render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
const mockNewSubmit = vi.fn();
const mockFeedbackSend = vi.fn();
const lastNewPid: { current: string } = { current: '' };

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./UndoBar', () => ({ UndoBar: () => null }));
vi.mock('./ActionDock', () => ({ ActionDock: ({ children }: { children: unknown }) => children }));
vi.mock('./AttachList', () => ({ AttachList: () => null }));
vi.mock('./PlatformPicker', () => ({
  PlatformPicker: ({ onChange }: { onChange: (p: string[]) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID="pick-ios" onPress={() => onChange(['ios'])}>
        <Text>iOS</Text>
      </Pressable>
    );
  },
}));
vi.mock('./PrimaryButton', () => ({
  PrimaryButton: ({
    label,
    onPress,
    disabled,
    testID,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    testID?: string;
  }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID={testID ?? 'primary'} disabled={disabled} onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    );
  },
}));
vi.mock('lucide-react-native', () => ({
  Mic: () => null,
  X: () => null,
}));
vi.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'zh' }],
}));
vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
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
vi.mock('../lib/net', () => ({ useOnline: () => true }));
vi.mock('../lib/viewport', () => ({ useKeyboardInset: () => 0 }));
vi.mock('../lib/client', () => ({
  isDemoMode: () => true,
  hub: { projects: vi.fn(async () => ({ ok: true, value: { projects: [] } })) },
}));
vi.mock('../lib/submit', () => ({
  refusalKey: () => 'common.error',
  useNewRequest: (pid: string) => {
    lastNewPid.current = pid;
    return { state: { phase: 'idle' }, submit: mockNewSubmit };
  },
}));
vi.mock('../lib/send', () => ({
  pendingKey: (k: string, pid: string, ref: string) => `${k}:${pid}:${ref}`,
  useSend: () => ({
    state: { phase: 'idle' },
    send: mockFeedbackSend,
  }),
}));

import NewRequestScreen from '../app/new';

describe('NewRequestScreen (SS-197)', () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
    mockNewSubmit.mockClear();
    mockFeedbackSend.mockClear();
    lastNewPid.current = '';
  });

  it('allows switching between multiple projects and submits under the selected project', async () => {
    const { getByTestId } = await render(<NewRequestScreen />);
    await fireEvent.press(getByTestId('new-project-proj-ops'));
    expect(lastNewPid.current).toBe('proj-ops');

    await fireEvent.changeText(getByTestId('goal-input'), '导出支持筛选');
    await fireEvent.press(getByTestId('pick-ios'));
    await fireEvent.press(getByTestId('primary'));
    expect(mockNewSubmit).toHaveBeenCalledWith('导出支持筛选', ['ios']);
  });

  it('fills goal-input when tapping an example chip', async () => {
    const { getByTestId } = await render(<NewRequestScreen />);
    await fireEvent.press(getByTestId('new-example-0'));
    expect(getByTestId('goal-input').props.value).toBe('登录页增加微信一键登录');
  });

  it('sends feedback via chat.send to the delivered request and navigates to /request/<id>', async () => {
    mockFeedbackSend.mockImplementation(
      async (build: (opId: string) => unknown, cbs?: { onDone?: () => void }) => {
        const action = build('op-1');
        expect(action).toEqual({
          t: 'action',
          opId: 'op-1',
          kind: 'chat.send',
          planRef: 'req-home',
          payload: { text: '圆角再大一点' },
        });
        cbs?.onDone?.();
      },
    );

    const { getByTestId } = await render(<NewRequestScreen />);
    await fireEvent.press(getByTestId('seg-feedback'));
    await fireEvent.changeText(getByTestId('goal-input'), '圆角再大一点');
    await fireEvent.press(getByTestId('primary'));

    expect(mockNewSubmit).not.toHaveBeenCalled();
    expect(mockFeedbackSend).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/request/req-home');
  });
});
