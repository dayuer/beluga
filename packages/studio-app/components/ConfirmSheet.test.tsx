import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../lib/viewport', () => ({ useKeyboardInset: () => 0 }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { resetDrawerCount } from '../lib/ui-state';
import { assertConfirmActionLabel, ConfirmSheet } from './ConfirmSheet';

describe('ConfirmSheet', () => {
  afterEach(() => {
    resetDrawerCount();
  });

  it('renders title once, uses caller confirmLabel, and triggers cancel/confirm callbacks', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    const screen = await render(
      <ConfirmSheet
        open
        onClose={onClose}
        title="移除后这台设备将无法确认操作"
        description="需要重新扫码登记才能恢复。"
        confirmLabel="移除设备"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getAllByText('移除后这台设备将无法确认操作')).toHaveLength(1);
    expect(screen.getByText('需要重新扫码登记才能恢复。')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('confirm-sheet-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('confirm-sheet-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('forbids generic 确定 or OK in assertConfirmActionLabel', () => {
    expect(() => assertConfirmActionLabel('确定')).toThrow();
    expect(() => assertConfirmActionLabel('OK')).toThrow();
    expect(() => assertConfirmActionLabel('上线')).not.toThrow();
  });
});
