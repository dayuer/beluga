import { useRef, useState, type ComponentRef } from 'react';
import {
  StyleSheet,
  TextInput,
  type TextInputContentSizeChangeEvent,
  type TextInputKeyPressEvent,
} from 'react-native';
import { LIMITS } from '../../../src/studio/protocol';
import { color, radius } from '../lib/theme';

export interface KeyPressLike {
  readonly key?: string;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
}

/**
 * 判断一次按键是否应当触发提交：
 * - 输入法组字中（`composing`、`nativeEvent.isComposing` 或 Android `keyCode === 229`）绝不提交，回车只上屏；
 * - 仅当按下 Enter 且满足「桌面 Cmd/Ctrl+Enter」或「显式开启 submitOnEnter 且未按 Shift」时提交；
 * - 多行输入框在手机上普通回车只换行（`docs/studio-mobile-ux.md §4`）。
 */
export function shouldSubmitOnKeyPress(
  nativeEvent: KeyPressLike | undefined,
  composing: boolean,
  submitOnEnter = false,
): boolean {
  if (!nativeEvent) return false;
  if (composing || nativeEvent.isComposing || nativeEvent.keyCode === 229) return false;
  if (nativeEvent.key !== 'Enter') return false;
  if (nativeEvent.metaKey || nativeEvent.ctrlKey) return true;
  if (submitOnEnter && !nativeEvent.shiftKey) return true;
  return false;
}

/**
 * The goal field: at least 120 tall, grows with the text up to `maxHeight` (40% of the visible
 * viewport, computed by the screen), then scrolls inside. 4000 characters, the protocol's cap.
 */
export function GoalInput({
  value,
  onChangeText,
  onBlur,
  onSubmit,
  submitOnEnter = false,
  maxHeight,
  placeholder,
  accessibilityLabel,
  testID = 'goal-input',
}: {
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  onSubmit?: () => void;
  submitOnEnter?: boolean;
  maxHeight: number;
  placeholder: string;
  accessibilityLabel: string;
  testID?: string;
}) {
  const [height, setHeight] = useState(120);
  const [focused, setFocused] = useState(false);
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const composingRef = useRef(false);

  const grow = (e: TextInputContentSizeChangeEvent) => {
    const next = Math.min(Math.max(e.nativeEvent.contentSize.height, 120), Math.max(120, maxHeight));
    setHeight(next);
  };

  const handleKeyPress = (e: TextInputKeyPressEvent) => {
    const native = e.nativeEvent as TextInputKeyPressEvent['nativeEvent'] & KeyPressLike;
    if (shouldSubmitOnKeyPress(native, composingRef.current, submitOnEnter)) {
      const prevent = (e as unknown as { preventDefault?: () => void }).preventDefault;
      prevent?.();
      onSubmit?.();
    }
  };

  const imeProps = {
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
    },
  };

  return (
    <TextInput
      ref={ref}
      value={value}
      onChangeText={onChangeText}
      onBlur={() => {
        setFocused(false);
        composingRef.current = false;
        onBlur?.();
      }}
      onKeyPress={handleKeyPress}
      onSubmitEditing={() => {
        if (submitOnEnter && !composingRef.current) onSubmit?.();
      }}
      onContentSizeChange={grow}
      onFocus={() => {
        setFocused(true);
        const input = ref.current as unknown as { scrollIntoView?: (opts?: unknown) => void } | null;
        setTimeout(() => input?.scrollIntoView?.({ block: 'nearest' }), 80);
      }}
      {...imeProps}
      multiline
      maxLength={LIMITS.text}
      placeholder={placeholder}
      placeholderTextColor={color.text3}
      cursorColor={color.info}
      selectionColor={color.info}
      textAlignVertical="top"
      scrollEnabled
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.input, focused && styles.inputFocused, { height, maxHeight: Math.max(120, maxHeight) }]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.m,
    backgroundColor: color.card,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    lineHeight: 22,
    color: color.text,
  },
  inputFocused: {
    borderColor: color.info,
  },
});
