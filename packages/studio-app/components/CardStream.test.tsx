import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-linking', () => ({ openURL: vi.fn() }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('react-native-keyboard-controller', () => ({
  KeyboardEvents: undefined,
  useKeyboardHandler: () => {},
  KeyboardProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../lib/keys', () => ({
  useHasDeviceKey: () => ({ hasKey: true, loading: false, refresh: vi.fn() }),
}));
vi.mock('../lib/haptics', () => ({
  haptics: { select: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock('react-native-svg', async () => {
  const r = await import('react');
  const host = (name: string) =>
    r.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      r.createElement(name, { ...props, ref }, props.children as React.ReactNode),
    );
  const Svg = host('Svg');
  return { default: Svg, Svg, Defs: host('Defs'), Pattern: host('Pattern'), Rect: host('Rect'), Line: host('Line') };
});

import { DEMO_CARDS, DEMO_REQUEST_VIEW } from '../lib/demo/screens';
import { setScheme } from '../lib/theme';
import { CardStream } from './CardStream';

describe('CardStream (SS-52 / SS-87)', () => {
  it('renders every card type once: the unsigned cards, the signed cards and the delivery notice', async () => {
    setScheme('light');
    const cards = [
      ...DEMO_REQUEST_VIEW.cards,
      { ...DEMO_CARDS.delivery!, id: 'card-delivery-done', status: 'done' as const },
      {
        id: 'card-unknown-1',
        kind: 'unknown' as const,
        rawKind: 'future-widget',
        createdAt: 1000,
        status: 'pending' as const,
        raw: {},
      },
    ];

    const screen = await render(<CardStream cards={cards} lang="zh" />);

    // 不用签名的 6 种卡
    expect(screen.getByTestId('card-card-design-1')).toBeTruthy();
    expect(screen.getByTestId('card-card-question-1')).toBeTruthy();
    expect(screen.getByTestId('card-card-understanding-1')).toBeTruthy();
    expect(screen.getByTestId('card-card-steps-1')).toBeTruthy();
    expect(screen.getByTestId('card-card-wait-offline')).toBeTruthy();
    expect(screen.getByTestId('card-card-code-1')).toBeTruthy();

    // 需要签名的卡：开工、改动、交付验收、上线
    expect(screen.getByTestId('card-card-start-1')).toBeTruthy();
    expect(screen.getByTestId('start-approve')).toBeTruthy();
    expect(screen.getByTestId('card-card-changes-1')).toBeTruthy();
    expect(screen.getByTestId('change-approve')).toBeTruthy();
    expect(screen.getByTestId('card-card-delivery-1')).toBeTruthy();
    expect(screen.getByTestId('accept-approve')).toBeTruthy();
    expect(screen.getByTestId('accept-not-yet')).toBeTruthy();
    expect(screen.getByTestId('card-card-release-1')).toBeTruthy();
    expect(screen.getByTestId('release-approve')).toBeTruthy();

    // 已通过的交付是通知卡（不是验收卡）
    expect(screen.getByTestId('card-card-delivery-done')).toBeTruthy();
    expect(screen.getByTestId('delivery-open-preview')).toBeTruthy();

    // unknown 留占位，且不露出内部 kind 码
    expect(screen.getByTestId('card-card-unknown-1')).toBeTruthy();
    expect(screen.getByText('暂不支持的卡片')).toBeTruthy();
    expect(screen.queryByText(/future-widget/)).toBeNull();
    expect(screen.queryByText(/\(start\)|\(changes\)|\(delivery\)|\(release\)/)).toBeNull();
  });
});
