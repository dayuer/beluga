import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { Header } from '../../components/Header';
import { Skeleton } from '../../components/Skeleton';
import { SyncBanner } from '../../components/SyncBanner';
import { getAppearance, setAppearance, useScheme, type AppearanceMode } from '../../lib/appearance';
import { hub } from '../../lib/client';
import { kv } from '../../lib/kv';
import { session } from '../../lib/session';
import { useSettingsView } from '../../lib/settings-source';
import { detectLang, t, type Lang } from '../../lib/strings';
import { tMe } from '../../lib/strings/me';
import { color, radius, space, type } from '../../lib/theme';

const PUSH_KEY = 'prefs:pushEnabled';

/**
 * 我 › 账号与通知（SS-59 / SS-200）：
 * - 邮箱、语言（点击区 ≥ 44pt）、外观设置（浅色 / 深色 / 跟随系统，存 kv，换 theme 色板并让原生控件跟随）；
 * - 通知开关（写 kv 供 A7 读取）；
 * - 退出登录走 hub.logout() + session.clear()（待 A7 合入后在 A9 换为 signOut()）；
 * - 删除账号独立处理，中台暂无删除接口时不可点并原地说明。
 */
export default function MeAccountScreen() {
  useScheme();
  const styles = createStyles();
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(() => detectLang());
  const [appearance, setAppearanceState] = useState<AppearanceMode>(() => getAppearance());
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const { data: settings, loading, offline } = useSettingsView();
  const [pushEnabled, setPushEnabled] = useState<boolean>(
    () => kv.get<boolean>(PUSH_KEY) ?? settings.account.pushEnabled,
  );
  const [confirmLogout, setConfirmLogout] = useState(false);

  const selectLang = (next: Lang) => {
    setLang(next);
    kv.set('lang', next);
  };

  const selectAppearance = (next: AppearanceMode) => {
    setAppearanceState(next);
    setAppearance(next);
  };

  const togglePush = (next: boolean) => {
    setPushEnabled(next);
    kv.set(PUSH_KEY, next);
  };

  const performSignOut = async () => {
    setConfirmLogout(false);
    await hub.logout().catch(() => {});
    session.clear();
    router.replace('/login');
  };

  return (
    <View style={styles.root} testID="me-account-screen">
      <Header title={tMe(lang, 'account.title')} back />
      {offline ? (
        <SyncBanner kind="offline" text={t(lang, 'common.offline')} testID="offline-banner" />
      ) : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {loading ? (
            <View testID="account-skeleton">
              <Skeleton count={3} />
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <View style={[styles.row, styles.rowBorder]}>
                  <Text style={styles.rowLabel}>{tMe(lang, 'account.email')}</Text>
                  <Text style={styles.rowValue} testID="account-email">
                    {settings.account.email || '—'}
                  </Text>
                </View>

                <View style={[styles.row, styles.rowBorder]}>
                  <Text style={styles.rowLabel}>{tMe(lang, 'account.language')}</Text>
                  <View style={styles.chipRow}>
                    {(['zh', 'en'] as const).map((code) => {
                      const active = lang === code;
                      return (
                        <Pressable
                          key={code}
                          onPress={() => selectLang(code)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          testID={`account-lang-${code}`}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>
                            {tMe(lang, code === 'zh' ? 'account.langZh' : 'account.langEn')}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={[styles.row, styles.rowBorder]}>
                  <Text style={styles.rowLabel}>{tMe(lang, 'account.appearance')}</Text>
                  <View style={styles.chipRow}>
                    {(['light', 'dark', 'system'] as const).map((mode) => {
                      const active = appearance === mode;
                      const key =
                        mode === 'light'
                          ? 'account.appearanceLight'
                          : mode === 'dark'
                            ? 'account.appearanceDark'
                            : 'account.appearanceSystem';
                      return (
                        <Pressable
                          key={mode}
                          onPress={() => selectAppearance(mode)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          testID={`account-appearance-${mode}`}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>
                            {tMe(lang, key)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.row}>
                  <View style={styles.pushText}>
                    <Text style={styles.rowLabel}>{tMe(lang, 'account.notifications')}</Text>
                    <Text style={styles.rowSub}>{tMe(lang, 'account.notificationsDesc')}</Text>
                  </View>
                  <Switch
                    value={pushEnabled}
                    onValueChange={togglePush}
                    testID="account-push-switch"
                  />
                </View>
              </View>

              <View style={styles.dangerGroup}>
                <Pressable
                  onPress={() => setConfirmLogout(true)}
                  accessibilityRole="button"
                  testID="account-logout"
                  style={({ pressed }) => [styles.actionRow, styles.rowBorder, pressed && styles.pressed]}
                >
                  <Text style={styles.actionText}>{tMe(lang, 'account.logout')}</Text>
                </Pressable>
                <Pressable
                  disabled
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  testID="account-delete"
                  style={[styles.actionRow, styles.actionDisabled]}
                >
                  <Text style={styles.dangerText}>{tMe(lang, 'account.delete')}</Text>
                </Pressable>
              </View>
              <Text style={styles.deleteNote} testID="account-delete-note">
                {tMe(lang, 'account.deleteUnavailable')}
              </Text>
            </>
          )}
        </View>
      </ScrollView>

      <ConfirmSheet
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title={tMe(lang, 'account.logoutTitle')}
        description={tMe(lang, 'account.logoutBody')}
        confirmLabel={tMe(lang, 'account.logoutConfirm')}
        cancelLabel={tMe(lang, 'account.cancel')}
        onConfirm={() => void performSignOut()}
        testID="account-logout-confirm"
      />
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[7] },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  card: {
    backgroundColor: color.card,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: color.hairline,
    overflow: 'hidden',
    marginBottom: space[5],
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[3],
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  rowLabel: { ...type.callout, fontWeight: '500', color: color.text },
  rowSub: { ...type.caption, color: color.text3, marginTop: 2 },
  rowValue: { ...type.callout, color: color.text2 },
  pushText: { flex: 1 },
  chipRow: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap', justifyContent: 'flex-end' },
  chip: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space[3],
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: color.primary,
    backgroundColor: color.card,
  },
  chipText: { ...type.caption, color: color.text2 },
  chipTextActive: { color: color.text, fontWeight: '600' },
  dangerGroup: {
    backgroundColor: color.card,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: color.hairline,
    overflow: 'hidden',
  },
  actionRow: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space[4],
  },
  actionDisabled: { opacity: 0.45 },
  pressed: { backgroundColor: color.press },
  actionText: { ...type.callout, fontWeight: '500', color: color.text },
  dangerText: { ...type.callout, fontWeight: '600', color: color.error },
  deleteNote: { ...type.caption, color: color.text3, marginTop: space[2], paddingHorizontal: space[1] },
});
