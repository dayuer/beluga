import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

import { PrimaryButton } from '../PrimaryButton';
import { TextButton } from '../TextButton';
import { ActionRow, assertSingleFilledButton } from './ActionRow';

describe('ActionRow', () => {
  it('renders primary-only, primary + negative, and primary + negative + hint layouts', async () => {
    const r1 = await render(<ActionRow primary={<PrimaryButton label="通过" onPress={() => {}} />} />);
    expect(r1.getByText('通过')).toBeTruthy();

    const r2 = await render(
      <ActionRow
        negative={<TextButton label="还不行…" onPress={() => {}} />}
        primary={<PrimaryButton label="通过" onPress={() => {}} />}
      />,
    );
    expect(r2.getByText('还不行…')).toBeTruthy();
    expect(r2.getByText('通过')).toBeTruthy();

    const r3 = await render(
      <ActionRow
        negative={<TextButton label="先不做…" onPress={() => {}} />}
        hint="由这台设备确认"
        primary={<PrimaryButton label="开始做" onPress={() => {}} />}
      />,
    );
    expect(r3.getByText('先不做…')).toBeTruthy();
    expect(r3.getByText('由这台设备确认')).toBeTruthy();
    expect(r3.getByText('开始做')).toBeTruthy();
  });

  it('throws in assertSingleFilledButton when more than one filled button is passed', () => {
    expect(() =>
      assertSingleFilledButton(
        <PrimaryButton label="取消" onPress={() => {}} />,
        <PrimaryButton label="确定" onPress={() => {}} />,
      ),
    ).toThrow(/至多允许一个实底按钮/);

    expect(() =>
      assertSingleFilledButton(
        <TextButton label="取消" onPress={() => {}} />,
        <PrimaryButton label="开始做" onPress={() => {}} />,
      ),
    ).not.toThrow();
  });
});
