import { usePathname, useRouter } from 'expo-router';
import { Folder, ListChecks } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { detectLang, t } from '../lib/strings';
import { color, space, stroke, type } from '../lib/theme';

/** The two roots: Projects and To-dos. A bottom bar on the phone; a 44pt segmented row on desktop. */
export function TabBar({ todoCount }: { readonly todoCount: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktop = width >= 900;
  const todoActive = pathname === '/todo';
  const items = [
    { to: '/', label: t(lang, 'todo.projects'), Icon: Folder, testID: 'tab-projects', active: !todoActive, badge: 0 },
    { to: '/todo', label: t(lang, 'todo.tab'), Icon: ListChecks, testID: 'tab-todo', active: todoActive, badge: todoCount },
  ] as const;
  const go = (to: string): void => {
    if (pathname !== to) router.replace(to);
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
          testID={item.testID}
          onPress={() => go(item.to)}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
        >
          <item.Icon size={21} color={item.active ? color.text : color.text2} strokeWidth={stroke} />
          <Text style={[styles.tabLabel, item.active && styles.tabOn]}>{item.label}</Text>
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
  tab: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { ...type.caption, color: color.text2 },
  tabOn: { color: color.text, fontWeight: '600' },
  badge: { position: 'absolute', top: 8, marginLeft: 22, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: color.text, color: color.onPrimary, ...type.caption, fontSize: 11, lineHeight: 18, textAlign: 'center', overflow: 'hidden' },
  segments: { height: 44, flexDirection: 'row', maxWidth: 720, width: '100%', alignSelf: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.hairline },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', flexDirection: 'row', gap: space[2], paddingBottom: 0 },
  segmentLabel: { ...type.callout, color: color.text2, paddingBottom: 10 },
  segmentOn: { color: color.text, fontWeight: '600' },
  segmentCount: { ...type.caption, color: color.text3, paddingBottom: 10 },
  segmentLine: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: 'transparent' },
  segmentLineOn: { backgroundColor: color.text },
  pressed: { backgroundColor: color.press },
});
