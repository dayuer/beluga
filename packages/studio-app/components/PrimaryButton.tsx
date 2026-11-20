import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Check } from 'lucide-react-native';
import { color, radius, space, stroke, type } from '../lib/theme';

export type PrimaryButtonState = 'idle' | 'working' | 'done';

export interface PrimaryButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly state?: PrimaryButtonState;
  /** 兼容旧调用方：未传 state 时，loading=true 等价于 working。 */
  readonly loading?: boolean;
  readonly disabled?: boolean;
  /** 进入 done 状态并展示对勾 1.2 秒后的回调。 */
  readonly onDone?: () => void;
  /** 失败回到 idle 时，在按钮旁显示的原因文案。 */
  readonly error?: string | null;
  readonly testID?: string;
}

const DONE_HOLD_MS = 1200;

/**
 * 主按钮三态（SS-28）：idle / working / done。
 * working 时不可点、锁定空闲时测得的宽度并显示转圈；done 显示对勾 1.2 秒后回调；
 * 失败回 idle 并在旁边一行显示原因。
 */
export function PrimaryButton({
  label,
  onPress,
  state,
  loading = false,
  disabled = false,
  onDone,
  error,
  testID = 'primary',
}: PrimaryButtonProps) {
  const effectiveState: PrimaryButtonState = state ?? (loading ? 'working' : 'idle');
  const [lockedWidth, setLockedWidth] = useState<number | undefined>(undefined);
  const firedInCurrentIdle = useRef(false);

  useEffect(() => {
    if (effectiveState === 'idle') {
      firedInCurrentIdle.current = false;
    }
  }, [effectiveState]);

  useEffect(() => {
    if (effectiveState !== 'done' || !onDone) return;
    const timer = setTimeout(() => {
      onDone();
    }, DONE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [effectiveState, onDone]);

  const off = disabled || effectiveState !== 'idle';

  const handleLayout = (e: LayoutChangeEvent) => {
    if (effectiveState === 'idle') {
      const w = Math.ceil(e.nativeEvent.layout.width);
      if (w > 0 && w !== lockedWidth) setLockedWidth(w);
    }
  };

  const handlePress = () => {
    if (off || firedInCurrentIdle.current) return;
    firedInCurrentIdle.current = true;
    onPress();
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: off, busy: effectiveState === 'working' }}
        testID={testID}
        disabled={off}
        onPress={handlePress}
        onLayout={handleLayout}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: color.primary },
          lockedWidth ? { minWidth: lockedWidth } : null,
          disabled && effectiveState === 'idle' && { backgroundColor: color.disabledFill },
          effectiveState === 'working' && styles.working,
          pressed && !off && styles.pressed,
        ]}
      >
        {effectiveState === 'working' ? (
          <ActivityIndicator size="small" color={color.onPrimary} />
        ) : effectiveState === 'done' ? (
          <Check size={18} color={color.onPrimary} strokeWidth={stroke} />
        ) : (
          <Text style={[styles.label, { color: color.onPrimary }, disabled && { color: color.text3 }]}>
            {label}
          </Text>
        )}
      </Pressable>
      {error && effectiveState === 'idle' ? (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: color.error }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space[2],
  },
  button: {
    minHeight: 52,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  working: { opacity: 0.85 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  label: { ...type.heading, textAlign: 'center' },
  error: { ...type.caption },
});
