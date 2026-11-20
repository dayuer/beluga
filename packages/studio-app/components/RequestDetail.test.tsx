import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockParams = vi.fn<() => { id?: string; card?: string; state?: string }>(() => ({ id: 'req-login' }));

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {} }));
vi.mock('expo-linking', () => ({ openURL: vi.fn() }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn() }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams(),
  useRouter: () => ({ back: vi.fn(), canGoBack: () => true, replace: vi.fn() }),
}));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../lib/keys', () => ({
  useHasDeviceKey: () => ({ hasKey: true, loading: false, refresh: vi.fn() }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('react-native-keyboard-controller', () => ({
  KeyboardEvents: undefined,
  useKeyboardHandler: () => {},
  KeyboardProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  Gesture: {
    Pan: () => {
      const chain = { onUpdate: () => chain, onEnd: () => chain };
      return chain;
    },
  },
}));
vi.mock('react-native-reanimated', async () => {
  const r = await import('react');
  const AnimatedView = r.forwardRef((props: Record<string, unknown>, ref: unknown) =>
    r.createElement('View', { ...props, ref }, props.children as React.ReactNode),
  );
  return {
    default: { View: AnimatedView },
    runOnJS: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useReducedMotion: () => true,
    useSharedValue: <T,>(v: T) => ({ value: v }),
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withSpring: <T,>(v: T) => v,
    withTiming: <T,>(v: T, _cfg?: unknown, cb?: (done: boolean) => void) => {
      cb?.(true);
      return v;
    },
  };
});
vi.mock('react-native-svg', async () => {
  const r = await import('react');
  const host = (name: string) =>
    r.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      r.createElement(name, { ...props, ref }, props.children as React.ReactNode),
    );
  const Svg = host('Svg');
  return { default: Svg, Svg, Defs: host('Defs'), Pattern: host('Pattern'), Rect: host('Rect'), Line: host('Line') };
});
vi.mock('lucide-react-native', async () => {
  const r = await import('react');
  const icon = (name: string) => (props: Record<string, unknown>) =>
    r.createElement('LucideIcon', { ...props, iconName: name });
  return {
    AlertCircle: icon('AlertCircle'),
    Check: icon('Check'),
    ChevronLeft: icon('ChevronLeft'),
    ChevronRight: icon('ChevronRight'),
    Clock: icon('Clock'),
    Download: icon('Download'),
    ExternalLink: icon('ExternalLink'),
    FileText: icon('FileText'),
    Gauge: icon('Gauge'),
    Globe: icon('Globe'),
    Image: icon('Image'),
    Info: icon('Info'),
    Layers: icon('Layers'),
    RotateCw: icon('RotateCw'),
    Send: icon('Send'),
    UserCheck: icon('UserCheck'),
    WifiOff: icon('WifiOff'),
  };
});

import RequestDetailScreen from '../app/request/[id]';
import { color } from '../lib/theme';
import { resetDrawerCount } from '../lib/ui-state';
import { undoStore } from '../lib/undo';
import { findAllJson } from '../test/json';

describe('RequestDetailScreen (SS-184 / SS-185)', () => {
  afterEach(() => {
    undoStore.cancel();
    resetDrawerCount();
    mockParams.mockReturnValue({ id: 'req-login' });
  });

  it('has a single vertical ScrollView, orders drawer tabs as outputs/changes/plan/preview, and yields UndoBar when drawer opens', async () => {
    const screen = await render(<RequestDetailScreen />);

    // 页面内只有一个纵向 ScrollView（抽屉未开时）
    const scrollViews = findAllJson(screen.toJSON(), (n) => n.type === 'ScrollView');
    expect(scrollViews).toHaveLength(1);

    // 触发 undoStore.show 后能看到撤销条
    await act(async () => {
      undoStore.show({ text: '已确认「需求理解」', ms: 4000, fire: vi.fn() });
    });
    expect(screen.getByText('已确认「需求理解」')).toBeTruthy();

    // 打开抽屉：撤销条让位（隐藏），且抽屉页签按 成果、改动、计划、预览 顺序渲染并能切换
    await fireEvent.press(screen.getByTestId('open-results-drawer'));
    expect(screen.queryByText('已确认「需求理解」')).toBeNull();

    const tablist = screen.getByTestId('segments');
    const tabLabels = findAllJson(tablist as never, (n) => n.type === 'Text').map((t) => t.props.children);
    expect(tabLabels).toEqual(['成果', '改动', '计划', '预览']);

    await fireEvent.press(screen.getByTestId('request-results-drawer-tab-changes'));
    expect(screen.getByTestId('drawer-changes-tab')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('request-results-drawer-tab-plan'));
    expect(screen.getByTestId('drawer-plan-tab')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('request-results-drawer-tab-preview'));
    expect(screen.getByTestId('drawer-preview-tab')).toBeTruthy();

    // 关闭抽屉后撤销条恢复可见
    await fireEvent.press(screen.getByTestId('drawer-close'));
    expect(screen.getByText('已确认「需求理解」')).toBeTruthy();
  });

  it('loads different cards per id and renders empty state for unknown id', async () => {
    mockParams.mockReturnValue({ id: 'req-push' });
    const pushScreen = await render(<RequestDetailScreen />);
    expect(pushScreen.getByText('发货通知模板消息')).toBeTruthy();
    expect(pushScreen.getByTestId('card-card-wait-offline')).toBeTruthy();
    expect(pushScreen.queryByTestId('card-card-design-1')).toBeNull();

    mockParams.mockReturnValue({ id: 'req-nonexistent' });
    const emptyScreen = await render(<RequestDetailScreen />);
    expect(emptyScreen.getByTestId('request-empty')).toBeTruthy();
    expect(emptyScreen.getByText('找不到这个需求')).toBeTruthy();
  });

  it('renders loading, offline, and runnerOffline states without red on WaitCard', async () => {
    mockParams.mockReturnValue({ id: 'req-login', state: 'loading' });
    const loadingScreen = await render(<RequestDetailScreen />);
    expect(loadingScreen.getByTestId('request-loading')).toBeTruthy();
    expect(loadingScreen.getByTestId('skeleton')).toBeTruthy();

    mockParams.mockReturnValue({ id: 'req-login', state: 'offline' });
    const offlineScreen = await render(<RequestDetailScreen />);
    expect(offlineScreen.getByTestId('sync-banner')).toBeTruthy();
    expect(offlineScreen.getByText('当前离线，先展示上次缓存的内容')).toBeTruthy();

    mockParams.mockReturnValue({ id: 'req-login', state: 'runnerOffline' });
    const runnerScreen = await render(<RequestDetailScreen />);
    expect(runnerScreen.getByTestId('card-card-wait-offline')).toBeTruthy();
    const waitNode = runnerScreen.getByTestId('card-card-wait-offline');
    const redNodes = findAllJson(
      waitNode as never,
      (n) => n.props.style?.color === color.error || n.props.style?.backgroundColor === color.error,
    );
    expect(redNodes).toHaveLength(0);
  });

  it('highlights and scrolls to target card when ?card= exists', async () => {
    mockParams.mockReturnValue({ id: 'req-login', card: 'card-understanding-1' });
    const screen = await render(<RequestDetailScreen />);
    const slot = screen.getByTestId('card-slot-card-understanding-1');
    const flatStyle = Object.assign({}, ...(Array.isArray(slot.props.style) ? slot.props.style : [slot.props.style]));
    expect(flatStyle.borderWidth).toBe(2);
    expect(flatStyle.borderColor).toBe(color.info);
  });
});
