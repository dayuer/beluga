import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { color, space, type } from '../lib/theme';

export type SyncKind = 'offline' | 'reconnecting' | 'restored';

/** The 34pt strip under the header: your own network, a reconnecting socket, or "back". */
export function SyncBanner({ kind, text, testID = 'sync-banner' }: { kind: SyncKind; text: string; testID?: string }) {
  const tone = kind === 'restored' ? color.ok : color.warn;
  const background = kind === 'restored' ? 'rgba(46,133,80,0.08)' : 'rgba(176,116,20,0.10)';

  return (
    <View
      accessibilityLiveRegion="polite"
      testID={testID}
      style={[styles.banner, { backgroundColor: background }]}
    >
      {kind === 'reconnecting' ? (
        <ActivityIndicator size="small" color={tone} />
      ) : (
        <View style={[styles.dot, { backgroundColor: tone }]} />
      )}
      <Text style={[styles.text, { color: tone }]} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 34,
    paddingVertical: 7,
    paddingHorizontal: space[5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  dot: { width: 7, height: 7, borderRadius: 999, flexShrink: 0 },
  text: { ...type.caption, flex: 1 },
});
