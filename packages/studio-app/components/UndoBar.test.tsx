import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { undoStore } from '../lib/undo';
import { UndoBar } from './UndoBar';

describe('UndoBar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    undoStore.cancel();
  });

  afterEach(() => {
    undoStore.cancel();
    vi.useRealTimers();
  });

  it('shows active undo item and cancels without firing action', async () => {
    const fire = vi.fn();
    const screen = await render(<UndoBar />);
    expect(screen.toJSON()).toBeNull();

    await act(async () => {
      undoStore.show({ text: '已通过「登录改版」', ms: 10_000, fire });
    });

    expect(screen.getByText('已通过「登录改版」')).toBeTruthy();
    const undoBtn = screen.getByText('撤销');
    await fireEvent.press(undoBtn);

    expect(screen.toJSON()).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(fire).not.toHaveBeenCalled();
  });
});
