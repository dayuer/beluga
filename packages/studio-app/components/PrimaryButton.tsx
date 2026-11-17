import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { color, radius, type } from '../lib/theme';

interface PrimaryButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly testID?: string;
}

/** The one filled button on a screen: 52 high, ink on light, readable when disabled. */
export function PrimaryButton({ label, onPress, disabled = false, loading = false, testID = 'primary' }: PrimaryButtonProps) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      testID={testID}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.button, off && styles.off, pressed && !off && styles.pressed]}
    >
      {loading ? <ActivityIndicator size="small" color={color.text3} /> : <Text style={[styles.label, off && styles.labelOff]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.m,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  off: { backgroundColor: '#E7E7EA' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  label: { ...type.heading, color: color.onPrimary, textAlign: 'center' },
  labelOff: { color: color.text3 },
});
