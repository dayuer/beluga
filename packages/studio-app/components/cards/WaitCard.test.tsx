import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { color, setScheme } from '../../lib/theme';
import type { WaitReason } from '../../lib/views';
import { findAllJson } from '../../test/json';
import { WaitCard, type WaitCardData } from './WaitCard';

const REASONS: readonly WaitReason[] = ['offline', 'queued', 'quota', 'needs-human'];

describe('WaitCard (SS-45)', () => {
  it.each(REASONS)('renders %s wait reason in grey without red and shows no-action note', async (reason) => {
    setScheme('light');
    const card: WaitCardData = {
      id: `wait-${reason}`,
      kind: 'wait',
      createdAt: 1000,
      status: 'pending',
      reason,
      message: '',
    };
    const screen = await render(<WaitCard card={card} lang="zh" />);

    expect(screen.getByTestId('wait-card-hint')).toBeTruthy();
    expect(screen.getByText('你不用做什么')).toBeTruthy();

    // 不使用红色
    const redNodes = findAllJson(
      screen.toJSON(),
      (n) => n.props.style?.color === color.error || n.props.style?.backgroundColor === color.error,
    );
    expect(redNodes).toHaveLength(0);
  });
});
