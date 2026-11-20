import { Redirect, Stack, useGlobalSearchParams, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSyncExternalStore, type ReactNode } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useBadgeSync } from '../lib/badge';
import { useBooted } from '../lib/boot';
import '../lib/kv';
import { usePushRegistration } from '../lib/push';
import { usePushOpen } from '../lib/push-open';
import { session } from '../lib/session';
import { color } from '../lib/theme';

/** 启动补水且 <Stack /> 挂载后再挂推送登记、角标同步与通知跳转。 */
function PushEffects({ canOpen }: { canOpen: boolean }) {
  usePushRegistration();
  useBadgeSync();
  usePushOpen(canOpen);
  return null;
}

/** 挂在 RootLayout 中与 <Guard> 同级：booted 后只挂载一次，跨 /login 重定向不卸载；仅在已登录且不在 /login 时跳卡。 */
function BootedPushEffects() {
  const booted = useBooted();
  const pathname = usePathname();
  const token = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  if (!booted) return null;
  return <PushEffects canOpen={Boolean(token) && pathname !== '/login'} />;
}

/**
 * The sign-in guard: no session → /login?next=<where they were>; a session on /login → the
 * projects list. `useSyncExternalStore` makes it react to login/logout and to a 401 clearing the
 * session. BLG-84 fills in the screens; the shell is here so the rule has one home.
 */
function Guard({ children }: { children: ReactNode }) {
  const booted = useBooted();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ next?: string | string[] }>();
  const token = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  if (!booted) {
    return <View style={{ flex: 1, backgroundColor: color.bg }} />;
  }
  if (!token && pathname !== '/login') {
    return <Redirect href={`/login?next=${encodeURIComponent(pathname)}`} />;
  }
  if (token && pathname === '/login') {
    // A magic link opened on /project/x remembers where the customer was going.
    const raw = Array.isArray(params.next) ? params.next[0] : params.next;
    const dest = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
    return <Redirect href={dest} />;
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <StatusBar style="dark" />
          <View style={{ flex: 1, backgroundColor: color.bg }}>
            <Guard>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />
            </Guard>
            <BootedPushEffects />
          </View>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
