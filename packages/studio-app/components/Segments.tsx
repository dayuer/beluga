import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, type } from '../lib/theme';

export interface SegmentItem {
  readonly key: string;
  readonly label: string;
  readonly testID: string;
}

/** The plan's tabs: one row of equal 44pt targets, ink text, a 2pt underline for the choice. */
export function Segments({ items, value, onChange }: { readonly items: readonly SegmentItem[]; readonly value: string; readonly onChange: (key: string) => void }) {
  return (
    <View
      style={[styles.row, { borderBottomColor: color.hairline, backgroundColor: color.bg }]}
      accessibilityRole="tablist"
      testID="segments"
    >
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            testID={item.testID}
            style={({ pressed }) => [styles.tab, pressed && { backgroundColor: color.press }]}
          >
            <Text style={[styles.label, { color: selected ? color.text : color.text2 }, selected && styles.labelSelected]}>
              {item.label}
            </Text>
            <View style={[styles.underline, { backgroundColor: selected ? color.text : 'transparent' }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 0 },
  label: { ...type.callout, fontWeight: '500', paddingBottom: 10 },
  labelSelected: { fontWeight: '600' },
  underline: { height: 2, width: '100%' },
});
