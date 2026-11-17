import { StyleSheet, View } from 'react-native';
import { radius } from '../lib/theme';

/** Static grey blocks in the shape of what is coming: no shimmer, no spinner over the page. */
export function Skeleton({ count = 3, variant = 'card' }: { count?: number; variant?: 'card' | 'row' }) {
  return (
    <View testID="skeleton" accessibilityLabel="加载中">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.block, variant === 'row' ? styles.row : styles.card]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: '#EFEFF1', borderRadius: radius.l, marginBottom: 12 },
  card: { height: 92 },
  row: { height: 64 },
});
