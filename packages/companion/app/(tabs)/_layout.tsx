import { Redirect, Tabs } from 'expo-router';
import { useLink } from '../../lib/hooks';
import { TabBar } from '../../components/TabBar';
import { color } from '../../lib/theme';

/** Home · Work · [Ask] · Chats · People, with the bar drawn by the app (components/TabBar.tsx). */
export default function TabsLayout() {
  // A customer's phone has no tabs: no Work, Files or Terminal behind them.
  const link = useLink();
  if (link.client) return <Redirect href="/client" />;
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg }, animation: 'shift' }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="work" options={{ title: 'Work' }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen name="people" options={{ title: 'People' }} />
    </Tabs>
  );
}
