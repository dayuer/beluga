import { Tabs } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import { TabBar } from '../../components/TabBar';
import { UndoBar } from '../../components/UndoBar';
import { useTodos } from '../../lib/todo-store';
import { useKeyboardInset } from '../../lib/viewport';

/**
 * 底部三页签导航骨架（SS-24 / SS-30）：需求（index）、待办（todo）、我（me）。
 * 全局 `<UndoBar />` 挂在 `TabBar` 上方，键盘弹起时随 `useKeyboardInset()` 上移到键盘之上。
 */
export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const { result } = useTodos();
  const todoCount = result?.todos.length ?? 0;
  const keyboardInset = useKeyboardInset();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={() => (
          <View pointerEvents="box-none">
            <View
              pointerEvents="box-none"
              style={keyboardInset > 0 ? { marginBottom: keyboardInset } : undefined}
            >
              <UndoBar />
            </View>
            {!desktop && keyboardInset === 0 ? <TabBar todoCount={todoCount} /> : null}
          </View>
        )}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="todo" />
        <Tabs.Screen name="me" />
      </Tabs>
    </View>
  );
}
