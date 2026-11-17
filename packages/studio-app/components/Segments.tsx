import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, space, type } from '../lib/theme';

export interface SegmentItem {
  readonly key: string;
  readonly label: string;
  readonly testID: string;
}

/** The plan's tabs: one row of equal 44pt targets, ink text, a 2pt underline for the choice. */
export function Segments({ items, value, onChange }: { readonly items: readonly SegmentItem[]; readonly value: string; readonly onChange: (key: string) => void }) {
  return (
    <View style={styles.row} accessibilityRole="tablist" testID="segments">
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            testID={item.testID}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{item.label}</Text>
            <View style={[styles.underline, selected && styles.underlineSelected]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.hairline, backgroundColor: color.bg },
  tab: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 0 },
  pressed: { backgroundColor: color.press },
  label: { ...type.callout, color: color.text2, fontWeight: '500', paddingBottom: 10 },
  labelSelected: { color: color.text, fontWeight: '600' },
  underline: { height: 2, width: '100%', backgroundColor: 'transparent' },
  underlineSelected: { backgroundColor: color.text },
});
