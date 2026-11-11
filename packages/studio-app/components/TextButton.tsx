import { Pressable, StyleSheet, Text } from 'react-native';
import { color, radius, type } from '../lib/theme';

/** A secondary action: no fill, at least 44 high, still a real hit target. */
export function TextButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: color.press },
  label: { ...type.callout, fontWeight: '500', color: color.text2 },
});
