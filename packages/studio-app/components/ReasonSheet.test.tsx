import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('../lib/viewport', () => ({ useKeyboardInset: () => 0 }));
vi.mock('../lib/submit', () => ({ refusalKey: (code: string) => `refusal.${code}` }));
vi.mock('../lib/send', () => ({
  pendingKey: (k: string, p: string, r: string, m: string) => `${k}:${p}:${r}:${m}`,
  useSend: () => ({ state: { phase: 'idle' }, send: vi.fn(), retry: vi.fn() }),
}));
vi.mock('../lib/kv', () => ({
  kv: {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => store.set(k, v),
    remove: (k: string) => store.delete(k),
  },
}));

import { ReasonSheet } from './ReasonSheet';

describe('ReasonSheet (P7)', () => {
  beforeEach(() => {
    store.clear();
  });

  afterEach(async () => {
    await cleanup();
  });

  it('shows how many characters are still needed when under 10 chars and disables submit', async () => {
    const screen = await render(<ReasonSheet cardId="card-1" onSubmit={() => {}} />);

    expect(screen.getByTestId('reason-too-short').props.children).toContain('还差 10 个字');
    expect(screen.getByTestId('reason-submit').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('reason-input'), '样式不对啊');
    expect(screen.getByTestId('reason-too-short').props.children).toContain('还差 5 个字');
    expect(screen.getByTestId('reason-submit').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('reason-input'), '导出按钮位置偏左需要调整');
    expect(screen.queryByTestId('reason-too-short')).toBeNull();
    expect(screen.getByTestId('reason-submit').props.accessibilityState.disabled).toBe(false);
  });

  it('keeps draft per cardId after closing and reopening', async () => {
    const first = await render(<ReasonSheet cardId="card-42" onSubmit={() => {}} />);
    await fireEvent.changeText(first.getByTestId('reason-input'), '按钮偏左');
    await first.unmount();

    const second = await render(<ReasonSheet cardId="card-42" onSubmit={() => {}} />);
    expect(second.getByTestId('reason-input').props.value).toBe('按钮偏左');
    await second.unmount();

    const other = await render(<ReasonSheet cardId="card-other" onSubmit={() => {}} />);
    expect(other.getByTestId('reason-input').props.value).toBe('');
  });

  it('clears draft after successful submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const screen = await render(<ReasonSheet cardId="card-99" onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('reason-input'), '导出按钮位置偏左，需要右移对齐');
    await fireEvent.press(screen.getByTestId('reason-submit'));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith('导出按钮位置偏左，需要右移对齐'));
    await screen.unmount();

    const reopened = await render(<ReasonSheet cardId="card-99" onSubmit={onSubmit} />);
    expect(reopened.getByTestId('reason-input').props.value).toBe('');
  });
});
