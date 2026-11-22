import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  info: null as null | {
    name: string;
    projectId: string;
    fileCount: number;
    imageCount: number;
    specCount: number;
    totalBytes: number;
    progress: number;
    status: string;
  },
}));

const submitMock = vi.fn();

const PICKED = {
  kind: 'zip' as const,
  name: '登录页设计稿.zip',
  uri: 'file:///tmp/login.zip',
  totalBytes: 2048,
  entries: [
    { path: 'login.png', size: 1024, source: { kind: 'zip' as const, zipUri: 'file:///tmp/login.zip', compressionMethod: 0, compressedSize: 1024, localHeaderOffset: 0, crc32: 1 } },
    { path: 'spec.json', size: 1024, source: { kind: 'zip' as const, zipUri: 'file:///tmp/login.zip', compressionMethod: 0, compressedSize: 1024, localHeaderOffset: 1024, crc32: 2 } },
  ],
};

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useLocalSearchParams: () => ({}),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../lib/cache', () => ({ cache: { get: () => undefined, set: () => {} } }));
vi.mock('../lib/session', () => ({
  session: { clear: vi.fn(), get: () => undefined, token: () => undefined },
}));
vi.mock('../lib/net', () => ({ useOnline: () => true }));
vi.mock('../lib/viewport', () => ({ useKeyboardInset: () => 0 }));
vi.mock('../lib/voice-recognizer', () => ({
  createVoiceRecognizer: () => ({
    requestPermission: async () => ({ granted: true }),
    start: async () => {},
    stop: async () => '',
    cancel: async () => {},
  }),
}));
vi.mock('../lib/client', () => ({
  isDemoMode: () => true,
  hub: { projects: vi.fn(async () => ({ ok: true, value: { projects: [] } })) },
}));
vi.mock('../lib/submit', () => ({
  refusalKey: () => 'common.error',
  useNewRequest: () => ({ state: { phase: 'idle' }, submit: submitMock }),
}));
vi.mock('../lib/send', () => ({
  pendingKey: (k: string, pid: string, ref: string) => `${k}:${pid}:${ref}`,
  useSend: () => ({ state: { phase: 'idle' }, send: vi.fn() }),
}));
vi.mock('../lib/package-pick', () => ({
  PACKAGE_LIMITS: { maxPackageBytes: 200 * 1024 * 1024, maxFileBytes: 25 * 1024 * 1024, maxFiles: 500 },
  pickDesignPackage: vi.fn(async () => ({ canceled: false, pkg: PICKED })),
}));
vi.mock('../lib/design-upload', () => ({
  useDesignUpload: () => ({
    uploader: { start: upload.start, machine: { getState: () => null } },
    info: upload.info,
  }),
}));
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./UndoBar', () => ({ UndoBar: () => null }));
vi.mock('./ActionDock', () => ({ ActionDock: ({ children }: { children: unknown }) => children }));
vi.mock('./AttachList', () => ({ AttachList: () => null }));
vi.mock('./GoalInput', () => ({
  GoalInput: ({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder?: string }) => {
    const { TextInput } = require('react-native');
    return <TextInput testID="goal-input" value={value} onChangeText={onChangeText} placeholder={placeholder} />;
  },
}));
vi.mock('./PlatformPicker', () => ({
  PlatformPicker: ({ onChange }: { onChange: (p: string[]) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID="platform-ios" onPress={() => onChange(['ios'])}>
        <Text>iOS</Text>
      </Pressable>
    );
  },
}));
vi.mock('./PrimaryButton', () => ({
  PrimaryButton: ({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID={testID ?? 'primary'} disabled={disabled} onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    );
  },
}));
vi.mock('./PackageManifest', () => ({
  PackageManifest: ({
    open,
    pkg,
    onConfirm,
  }: {
    open: boolean;
    pkg: { entries: unknown[] } | null;
    onConfirm: (entries: unknown[]) => void;
  }) => {
    const { Pressable, Text, View } = require('react-native');
    if (!open || !pkg) return null;
    return (
      <View testID="package-manifest">
        <Text>清单</Text>
        <Pressable testID="package-manifest-confirm" onPress={() => onConfirm(pkg.entries)}>
          <Text>开始上传</Text>
        </Pressable>
      </View>
    );
  },
}));
vi.mock('lucide-react-native', () => ({
  Check: () => null,
  Mic: () => null,
  X: () => null,
}));

import NewRequestScreen from '../app/new';

describe('提需求页的设计稿包（SS-88）', () => {
  beforeEach(() => {
    upload.start.mockClear();
    submitMock.mockClear();
    upload.info = null;
  });

  it('选包 → 清单 → 确认后开始后台上传，带项目与包里的文件', async () => {
    const screen = await render(<NewRequestScreen />);

    await fireEvent.press(screen.getByTestId('pick-package'));
    await waitFor(() => expect(screen.getByTestId('package-manifest')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('package-manifest-confirm'));

    await waitFor(() => expect(upload.start).toHaveBeenCalledTimes(1));
    expect(upload.start).toHaveBeenCalledWith({
      projectId: 'proj-shop',
      name: '登录页设计稿.zip',
      entries: PICKED.entries,
    });
    expect(screen.queryByTestId('package-manifest')).toBeNull();
    // 传过之后能再打开清单
    expect(screen.getByTestId('view-package-manifest')).toBeTruthy();
  });

  it('边传边能发需求：上传进度显示在卡片上，提交按钮照常可用', async () => {
    upload.info = {
      name: '登录页设计稿.zip',
      projectId: 'proj-shop',
      fileCount: 2,
      imageCount: 1,
      specCount: 1,
      totalBytes: 2048,
      progress: 0.35,
      status: 'uploading',
    };

    const screen = await render(<NewRequestScreen />);

    expect(screen.getByTestId('design-upload-card')).toBeTruthy();
    expect(screen.getByText(/上传中 35%/)).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('goal-input'), '按设计稿改登录页');
    await fireEvent.press(screen.getByTestId('platform-ios'));
    await fireEvent.press(screen.getByTestId('primary'));

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith('按设计稿改登录页', ['ios']);
  });
});
