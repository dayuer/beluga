import { useRouter } from 'expo-router';
import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ChevronLeft, RotateCw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, space, stroke, type } from '../lib/theme';

interface HeaderProps {
  readonly title: string;
  readonly back?: boolean;
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  readonly testID?: string;
}

function IconButton({ label, testID, onPress, children }: { label: string; testID: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, pressed && styles.iconPressed]}
    >
      {children}
    </Pressable>
  );
}

/** The solid title bar: mobile 44 + safe top with a centered title; desktop 56 with the title
 * beside the back button. A 1px hairline always; no gradient, no blur. */
export function Header({ title, back = false, onRefresh, refreshing = false, testID = 'header' }: HeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  return (
    <View style={[styles.bar, { paddingTop: desktop ? 0 : insets.top }]} testID={testID}>
      <View style={[styles.row, desktop && styles.rowDesktop]}>
        {back ? (
          <IconButton label="返回" testID="back" onPress={() => router.back()}>
            <ChevronLeft size={20} strokeWidth={stroke} color={color.text2} />
          </IconButton>
        ) : (
          <View style={styles.slot} />
        )}
        <Text style={[styles.title, desktop && styles.titleDesktop]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {onRefresh ? (
          <IconButton label="刷新" testID="refresh" onPress={onRefresh}>
            {refreshing ? <ActivityIndicator size="small" color={color.text2} /> : <RotateCw size={19} strokeWidth={stroke} color={color.text2} />}
          </IconButton>
        ) : (
          <View style={styles.slot} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: color.bar,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  row: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
  },
  rowDesktop: {
    height: 56,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 0,
  },
  slot: { width: 44, height: 44 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: { backgroundColor: color.press },
  title: {
    ...type.heading,
    color: color.text,
    flex: 1,
    textAlign: 'center',
  },
  titleDesktop: { textAlign: 'left', marginLeft: space[3] },
});
