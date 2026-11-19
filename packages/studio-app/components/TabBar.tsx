import { usePathname, useRouter } from 'expo-router';
import { ListChecks, MessageSquare, User } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { select } from '../lib/haptics';
import { color, space, stroke, type } from '../lib/theme';
import { useDrawerOpen } from '../lib/ui-state';

export interface TabBarProps {
  readonly todoCount?: number;
}

/**
 * 手机底部三个页签（SS-24）：需求 · 待办 · 我。
 * 抽屉打开时自动隐藏让位；切换页签时触发选择触感（`haptics.select`）。
 */
export function TabBar({ todoCount = 0 }: TabBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const drawerOpen = useDrawerOpen();
  const desktop = width >= 900;

  if (drawerOpen) return null;

  const isTodo = pathname === '/todo';
  const isMe = pathname === '/me';
  const isRequests = !isTodo && !isMe;

  const items = [
    { to: '/', label: '需求', Icon: MessageSquare, testID: 'tab-requests', active: isRequests, badge: 0 },
    { to: '/todo', label: '待办', Icon: ListChecks, testID: 'tab-todo', active: isTodo, badge: todoCount },
    { to: '/me', label: '我', Icon: User, testID: 'tab-me', active: isMe, badge: 0 },
  ] as const;

  const go = (to: string): void => {
    if (pathname !== to) {
      select();
      router.replace(to);
    }
  };

  if (desktop) {
    return (
      <View style={styles.segments} testID="tab-bar">
        {items.map((item) => (
          <Pressable
            key={item.to}
            accessibilityRole="tab"
            accessibilityState={{ selected: item.active }}
            testID={item.testID}
            onPress={() => go(item.to)}
            style={({ pressed }) => [styles.segment, pressed && styles.pressed]}
          >
            <Text style={[styles.segmentLabel, item.active && styles.segmentOn]}>{item.label}</Text>
            {item.badge > 0 ? (
              <Text style={styles.segmentCount} testID={item.testID === 'tab-todo' ? 'tab-todo-count' : undefined}>
                {item.badge > 99 ? '99+' : item.badge}
              </Text>
            ) : null}
            <View style={[styles.segmentLine, item.active && styles.segmentLineOn]} />
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]} testID="tab-bar">
      {items.map((item) => (
        <Pressable
          key={item.to}
          accessibilityRole="tab"
          accessibilityState={{ selected: item.active }}
          accessibilityLabel={item.label}
          testID={item.testID}
          onPress={() => go(item.to)}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
        >
          <item.Icon size={21} color={item.active ? color.text : color.text2} strokeWidth={stroke} />
          <Text style={[styles.tabLabel, item.active && styles.tabOn]} numberOfLines={1}>
            {item.label}
          </Text>
          {item.badge > 0 ? (
            <Text style={styles.badge} testID={item.testID === 'tab-todo' ? 'tab-todo-count' : undefined}>
              {item.badge > 99 ? '99+' : item.badge}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: color.bar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
  tab: { flex: 1, minWidth: 0, height: 56, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { ...type.caption, color: color.text2 },
  tabOn: { color: color.text, fontWeight: '600' },
  badge: { position: 'absolute', top: 8, marginLeft: 22, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: color.text, color: color.onPrimary, ...type.caption, fontSize: 11, lineHeight: 18, textAlign: 'center', overflow: 'hidden' },
  segments: { height: 44, flexDirection: 'row', maxWidth: 720, width: '100%', alignSelf: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.hairline },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', flexDirection: 'row', gap: space[2], paddingBottom: 0 },
  segmentLabel: { ...type.callout, color: color.text2, paddingBottom: 10 },
  segmentOn: { color: color.text, fontWeight: '600' },
  segmentCount: { ...type.caption, color: color.text2, paddingBottom: 10 },
  segmentLine: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: 'transparent' },
  segmentLineOn: { backgroundColor: color.text },
  pressed: { backgroundColor: color.press },
});
