import { usePathname, useRouter } from 'expo-router';
import { ListChecks, MessageSquare, User } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { select } from '../lib/haptics';
import { detectLang, t } from '../lib/strings';
import { color, space, stroke, type } from '../lib/theme';
import { useDrawerOpen } from '../lib/ui-state';

export interface TabBarProps {
  readonly todoCount?: number;
}

/**
 * 手机底部三个页签（SS-24 / SS-140）：需求 · 待办 · 我。
 * 抽屉打开时自动隐藏让位；切换页签时触发选择触感（`haptics.select`）；
 * 颜色在渲染期读取 `color.*`，支持深色模式实时切换。
 */
export function TabBar({ todoCount = 0 }: TabBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const drawerOpen = useDrawerOpen();
  const desktop = width >= 900;

  if (drawerOpen) return null;

  const isTodo = pathname === '/todo';
  const isMe = pathname === '/me';
  const isRequests = !isTodo && !isMe;

  const items = [
    { to: '/', label: t(lang, 'tabs.requests'), Icon: MessageSquare, testID: 'tab-requests', active: isRequests, badge: 0 },
    { to: '/todo', label: t(lang, 'tabs.todo'), Icon: ListChecks, testID: 'tab-todo', active: isTodo, badge: todoCount },
    { to: '/me', label: t(lang, 'tabs.me'), Icon: User, testID: 'tab-me', active: isMe, badge: 0 },
  ] as const;

  const go = (to: string): void => {
    if (pathname !== to) {
      select();
      router.replace(to);
    }
  };

  if (desktop) {
    return (
      <View style={[styles.segments, { borderBottomColor: color.hairline }]} testID="tab-bar">
        {items.map((item) => (
          <Pressable
            key={item.to}
            accessibilityRole="tab"
            accessibilityState={{ selected: item.active }}
            testID={item.testID}
            onPress={() => go(item.to)}
            style={({ pressed }) => [styles.segment, pressed && { backgroundColor: color.press }]}
          >
            <Text style={[styles.segmentLabel, { color: item.active ? color.text : color.text2 }, item.active && styles.onWeight]}>
              {item.label}
            </Text>
            {item.badge > 0 ? (
              <Text
                style={[styles.segmentCount, { color: color.text2 }]}
                testID={item.testID === 'tab-todo' ? 'tab-todo-count' : undefined}
              >
                {item.badge > 99 ? '99+' : item.badge}
              </Text>
            ) : null}
            <View style={[styles.segmentLine, item.active && { backgroundColor: color.text }]} />
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: insets.bottom,
          backgroundColor: color.bar,
          borderTopColor: color.hairline,
        },
      ]}
      testID="tab-bar"
    >
      {items.map((item) => (
        <Pressable
          key={item.to}
          accessibilityRole="tab"
          accessibilityState={{ selected: item.active }}
          accessibilityLabel={item.label}
          testID={item.testID}
          onPress={() => go(item.to)}
          style={({ pressed }) => [styles.tab, pressed && { backgroundColor: color.press }]}
        >
          <item.Icon size={21} color={item.active ? color.text : color.text2} strokeWidth={stroke} />
          <Text
            style={[styles.tabLabel, { color: item.active ? color.text : color.text2 }, item.active && styles.onWeight]}
            numberOfLines={1}
          >
            {item.label}
          </Text>
          {item.badge > 0 ? (
            <Text
              style={[styles.badge, { backgroundColor: color.text, color: color.onPrimary }]}
              testID={item.testID === 'tab-todo' ? 'tab-todo-count' : undefined}
            >
              {item.badge > 99 ? '99+' : item.badge}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minWidth: 0, height: 56, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { ...type.caption },
  onWeight: { fontWeight: '600' },
  badge: {
    position: 'absolute',
    top: 8,
    marginLeft: 22,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    ...type.caption,
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
    overflow: 'hidden',
  },
  segments: {
    height: 44,
    flexDirection: 'row',
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', flexDirection: 'row', gap: space[2], paddingBottom: 0 },
  segmentLabel: { ...type.callout, paddingBottom: 10 },
  segmentCount: { ...type.caption, paddingBottom: 10 },
  segmentLine: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: 'transparent' },
});
