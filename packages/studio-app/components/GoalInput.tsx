import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, TextInput, type TextInputContentSizeChangeEvent } from 'react-native';
import { LIMITS } from '../../../src/studio/protocol';
import { color, radius, type } from '../lib/theme';

/**
 * The goal field: at least 120 tall, grows with the text up to `maxHeight` (40% of the visible
 * viewport, computed by the screen), then scrolls inside. 4000 characters, the protocol's cap.
 */
export function GoalInput({
  value,
  onChangeText,
  onBlur,
  maxHeight,
  placeholder,
  accessibilityLabel,
  testID = 'goal-input',
}: {
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  maxHeight: number;
  placeholder: string;
  accessibilityLabel: string;
  testID?: string;
}) {
  const [height, setHeight] = useState(120);
  const ref = useRef<ComponentRef<typeof TextInput>>(null);

  const grow = (e: TextInputContentSizeChangeEvent) => {
    const next = Math.min(Math.max(e.nativeEvent.contentSize.height, 120), Math.max(120, maxHeight));
    setHeight(next);
  };

  return (
    <TextInput
      ref={ref}
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      onContentSizeChange={grow}
      onFocus={() => {
        const input = ref.current as unknown as { scrollIntoView?: (opts?: unknown) => void } | null;
        setTimeout(() => input?.scrollIntoView?.({ block: 'nearest' }), 80);
      }}
      multiline
      maxLength={LIMITS.text}
      placeholder={placeholder}
      placeholderTextColor={color.text3}
      textAlignVertical="top"
      scrollEnabled
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.input, { height, maxHeight: Math.max(120, maxHeight) }]}
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
});
