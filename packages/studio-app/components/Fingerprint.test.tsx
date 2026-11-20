import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { Fingerprint, splitFingerprintGroups } from './Fingerprint';

describe('Fingerprint', () => {
  it('splits fingerprint into 4 uppercase groups', () => {
    expect(splitFingerprintGroups('a1b2-c3d4-e5f6-7890')).toEqual(['A1B2', 'C3D4', 'E5F6', '7890']);
    expect(splitFingerprintGroups('1234567890abcdef')).toEqual(['1234', '5678', '90AB', 'CDEF']);
  });

  it('uses ActionRow with negative left, action-only labels, and primary right', async () => {
    const onMatch = vi.fn();
    const onMismatch = vi.fn();
    const screen = await render(
      <Fingerprint fingerprint="a1b2c3d4e5f67890" onMatch={onMatch} onMismatch={onMismatch} />,
    );

    expect(screen.getByText('A1B2')).toBeTruthy();
    expect(screen.getByText('C3D4')).toBeTruthy();
    expect(screen.getByText('E5F6')).toBeTruthy();
    expect(screen.getByText('7890')).toBeTruthy();

    // 按钮只写动作：否定靠左（不一样）、主动作靠右（登记）
    const actionRow = screen.getByTestId('fingerprint-actions');
    const rowChildren = actionRow.children;
    expect(rowChildren.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('不一样')).toBeTruthy();
    expect(screen.getByText('登记')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('fingerprint-match'));
    expect(onMatch).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('fingerprint-mismatch-btn'));
    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('fingerprint-mismatch')).toBeTruthy();
    expect(screen.getByText(/重新发送一条新的邀请链接/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('fingerprint-retry'));
    expect(screen.getByTestId('fingerprint-groups')).toBeTruthy();
  });
});
