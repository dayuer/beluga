import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findAllJson } from '../test/json';
import { PrimaryButton, REARM_MS } from './PrimaryButton';

describe('PrimaryButton', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders idle, working (with locked width), and done (calling onDone after 1200ms)', async () => {
    const onPress = vi.fn();
    const onDone = vi.fn();
    const screen = await render(<PrimaryButton label="提交" onPress={onPress} state="idle" />);

    const btn = screen.getByTestId('primary');
    await fireEvent(btn, 'layout', { nativeEvent: { layout: { width: 140, height: 52 } } });

    await screen.rerender(<PrimaryButton label="提交" onPress={onPress} state="working" />);
    const workingBtn = screen.getByTestId('primary');
    expect(workingBtn.props.accessibilityState.busy).toBe(true);
    expect(workingBtn.props.style.minWidth).toBe(140);
    expect(findAllJson(screen.toJSON(), (n) => n.type === 'ActivityIndicator')).toHaveLength(1);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await screen.rerender(<PrimaryButton label="提交" onPress={onPress} state="done" onDone={onDone} />);
    expect(findAllJson(screen.toJSON(), (n) => n.props.iconName === 'Check')).toHaveLength(1);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1200);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('fires onPress only once on rapid double-tap and shows error when back in idle', async () => {
    const onPress = vi.fn();
    const screen = await render(<PrimaryButton label="开始做" onPress={onPress} state="idle" />);

    const btn = screen.getByTestId('primary');
    await fireEvent.press(btn);
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);

    await screen.rerender(<PrimaryButton label="开始做" onPress={onPress} state="idle" error="网络超时，请重试" />);
    expect(screen.getByText('网络超时，请重试')).toBeTruthy();
  });
  it('works again after the double-tap window when its state never leaves idle (navigation button)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onPress = vi.fn();
    const screen = await render(<PrimaryButton label="新需求" onPress={onPress} />);
    const btn = screen.getByTestId('primary');
    await fireEvent.press(btn);
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REARM_MS);
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
