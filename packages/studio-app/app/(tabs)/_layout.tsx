import { Tabs } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import { TabBar } from '../../components/TabBar';
import { useTodos } from '../../lib/todo-store';

/**
 * 底部三页签导航骨架（SS-24）：需求（index）、待办（todo）、我（me）。
 * 留出外层插槽，供 SS-30 在页签上方挂载全局 `<UndoBar />`。
 */
export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const { result } = useTodos();
  const todoCount = result?.todos.length ?? 0;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={() => (!desktop ? <TabBar todoCount={todoCount} /> : null)}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="todo" />
        <Tabs.Screen name="me" />
      </Tabs>
    </View>
  );
}
