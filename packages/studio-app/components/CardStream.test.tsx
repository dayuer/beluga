import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { DEMO_REQUEST_VIEW } from '../lib/demo/screens';
import { setScheme } from '../lib/theme';
import { CardStream } from './CardStream';

describe('CardStream (SS-52)', () => {
  it('renders every non-signed card in DEMO_REQUEST_VIEW and placeholders for signed/unknown cards', async () => {
    setScheme('light');
    const cards = [
      ...DEMO_REQUEST_VIEW.cards,
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

    // 需签名的卡与 unknown 留占位
    expect(screen.getByTestId('card-card-start-1')).toBeTruthy();
    expect(screen.getByTestId('card-card-unknown-1')).toBeTruthy();
    expect(screen.getByText('暂不支持的卡片')).toBeTruthy();
  });
});
