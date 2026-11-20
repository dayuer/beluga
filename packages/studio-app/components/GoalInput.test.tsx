import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';
import { GoalInput, shouldSubmitOnKeyPress } from './GoalInput';

// lib/appearance 读 kv，kv 用 expo-file-system；node 下没有原生模块，给个空的。
vi.mock('expo-file-system', () => ({
  Paths: { document: '/mock-doc' },
  File: class {},
}));

describe('GoalInput IME and submit behavior', () => {
  it('never submits while composing (composition state, isComposing, or Android keyCode 229)', () => {
    expect(shouldSubmitOnKeyPress({ key: 'Enter' }, true, true)).toBe(false);
    expect(shouldSubmitOnKeyPress({ key: 'Enter', isComposing: true }, false, true)).toBe(false);
    expect(shouldSubmitOnKeyPress({ key: 'Enter', keyCode: 229 }, false, true)).toBe(false);
    expect(shouldSubmitOnKeyPress({ key: 'Enter', metaKey: true, isComposing: true }, false, false)).toBe(false);
  });

  it('keeps Enter as newline for multiline by default, and submits on Cmd/Ctrl+Enter', () => {
    expect(shouldSubmitOnKeyPress({ key: 'Enter' }, false, false)).toBe(false);
    expect(shouldSubmitOnKeyPress({ key: 'Enter', metaKey: true }, false, false)).toBe(true);
    expect(shouldSubmitOnKeyPress({ key: 'Enter', ctrlKey: true }, false, false)).toBe(true);
    expect(shouldSubmitOnKeyPress({ key: 'Enter' }, false, true)).toBe(true);
    expect(shouldSubmitOnKeyPress({ key: 'Enter', shiftKey: true }, false, true)).toBe(false);
  });

  it('ignores Enter during composition in rendered GoalInput and submits after compositionEnd', async () => {
    const onSubmit = vi.fn();
    const { getByTestId } = await render(
      <GoalInput
        value="nihao"
        onChangeText={() => {}}
        onSubmit={onSubmit}
        submitOnEnter
        maxHeight={300}
        placeholder="输入需求"
        accessibilityLabel="输入需求"
      />,
    );

    const input = getByTestId('goal-input');
    fireEvent(input, 'compositionStart');
    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Enter' } });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Enter', isComposing: true } });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent(input, 'compositionEnd');
    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Enter' } });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
