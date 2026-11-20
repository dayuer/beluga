import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Header } from '../../components/Header';
import { TabBar } from '../../components/TabBar';
import { DEMO_SETTINGS_VIEW } from '../../lib/demo';
import { kv } from '../../lib/kv';
import { detectLang } from '../../lib/strings';
import { tMe } from '../../lib/strings/me';
import { color, radius, space, type } from '../../lib/theme';
import { useTodos } from '../../lib/todo-store';

interface MeRowProps {
  readonly label: string;
  readonly value?: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly last?: boolean;
}

function MeRow({ label, value, onPress, testID, last }: MeRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && styles.pressed]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? (
          <Text style={styles.rowValue} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        <ChevronRight size={16} color={color.text3} />
      </View>
    </Pressable>
  );
}

/**
 * P9「我」入口页（SS-54）：账号头 + 两个分组行，每行进入 `app/me/<页>.tsx`。
 */
export default function MeScreen() {
  const router = useRouter();
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const { result } = useTodos();
  const todoCount = result?.todos.length ?? 0;

  const settings = DEMO_SETTINGS_VIEW;
  const onlineRunners = settings.runners.filter((r) => r.online).length;
  const pushPref = kv.get<boolean>('prefs:pushEnabled');
  const pushOn = pushPref ?? settings.account.pushEnabled;

  return (
    <View style={styles.root} testID="me-screen">
      <Header title={tMe(lang, 'me.title')} />
      {desktop ? <TabBar todoCount={todoCount} /> : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          <View style={styles.accountCard} testID="me-account-header">
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(settings.account.email[0] ?? 'S').toUpperCase()}
              </Text>
            </View>
            <View style={styles.accountMeta}>
              <Text style={styles.accountEmail} numberOfLines={1}>
                {settings.account.email}
              </Text>
              <Text style={styles.accountCaption}>{tMe(lang, 'me.accountHeader')}</Text>
            </View>
          </View>

          <Text style={styles.groupTitle}>{tMe(lang, 'me.groupWorkspace')}</Text>
          <View style={styles.groupCard}>
            <MeRow
              label={tMe(lang, 'me.rowProject')}
              value={tMe(lang, 'me.rowProjectSub', { n: settings.projects.length })}
              onPress={() => router.push('/me/project')}
              testID="me-row-project"
            />
            <MeRow
              label={tMe(lang, 'me.rowEnv')}
              value={tMe(lang, 'me.rowEnvSub')}
              onPress={() => router.push('/me/env')}
              testID="me-row-env"
            />
            <MeRow
              label={tMe(lang, 'me.rowMachines')}
              value={tMe(lang, 'me.rowMachinesSub', {
                online: onlineRunners,
                total: settings.runners.length,
              })}
              onPress={() => router.push('/me/machines')}
              testID="me-row-machines"
              last
            />
          </View>

          <Text style={styles.groupTitle}>{tMe(lang, 'me.groupAccount')}</Text>
          <View style={styles.groupCard}>
            <MeRow
              label={tMe(lang, 'me.rowDevices')}
              value={tMe(lang, 'me.rowDevicesSub', { n: settings.devices.length })}
              onPress={() => router.push('/me/devices')}
              testID="me-row-devices"
            />
            <MeRow
              label={tMe(lang, 'me.rowNotifications')}
              value={tMe(lang, pushOn ? 'me.rowNotificationsOn' : 'me.rowNotificationsOff')}
              onPress={() => router.push('/me/account')}
              testID="me-row-notifications"
            />
            <MeRow
              label={tMe(lang, 'me.rowAccount')}
              value={settings.account.email}
              onPress={() => router.push('/me/account')}
              testID="me-row-account"
              last
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[7] },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    backgroundColor: color.card,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space[4],
    marginBottom: space[6],
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...type.heading, color: color.card },
  accountMeta: { flex: 1, gap: 2 },
  accountEmail: { ...type.heading, color: color.text },
  accountCaption: { ...type.caption, color: color.text3 },
  groupTitle: {
    ...type.caption,
    fontWeight: '600',
    color: color.text3,
    marginBottom: space[2],
    marginLeft: space[1],
  },
  groupCard: {
    backgroundColor: color.card,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: color.hairline,
    marginBottom: space[5],
    overflow: 'hidden',
  },
  row: {
    minHeight: 48,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  pressed: { backgroundColor: color.press },
  rowLabel: { ...type.callout, fontWeight: '500', color: color.text },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1 },
  rowValue: { ...type.caption, color: color.text3, flexShrink: 1 },
});
