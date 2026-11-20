import { Pressable, StyleSheet, Text } from 'react-native';
import { color, radius, type } from '../lib/theme';

/** A secondary action: no fill, at least 44 high, still a real hit target. */
export function TextButton({
  label,
  onPress,
  testID,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  /** 不能开始时仍占位并说明原因，不要让它看起来可点。 */
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && !disabled && styles.pressed]}
    >
      <Text style={[styles.label, disabled && styles.disabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.sunken,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  pressed: { backgroundColor: color.press },
  label: { ...type.callout, fontWeight: '500', color: color.text2 },
  disabled: { color: color.text3 },
});
