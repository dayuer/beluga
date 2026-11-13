import { Redirect, Stack, useGlobalSearchParams, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSyncExternalStore, type ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { session } from '../lib/session';
import { color } from '../lib/theme';

/**
 * The sign-in guard: no session → /login?next=<where they were>; a session on /login → the
 * projects list. `useSyncExternalStore` makes it react to login/logout and to a 401 clearing the
 * session. BLG-84 fills in the screens; the shell is here so the rule has one home.
 */
function Guard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ next?: string | string[] }>();
  const token = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
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
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <Guard>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />
        </Guard>
      </View>
    </SafeAreaProvider>
  );
}
