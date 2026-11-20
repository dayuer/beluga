import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { Header } from '../../components/Header';
import { DEMO_SETTINGS_VIEW } from '../../lib/demo';
import { kv } from '../../lib/kv';
import { session } from '../../lib/session';
import { detectLang, type Lang } from '../../lib/strings';
import { tMe } from '../../lib/strings/me';
import { color, radius, space, type } from '../../lib/theme';

const PUSH_KEY = 'prefs:pushEnabled';

/**
 * 我 › 账号与通知（SS-59）：
 * 邮箱、语言、通知开关（写入 kv 供 A7 读取）、退出登录（ConfirmSheet）、
 * 删除账号（ConfirmSheet，说明不可恢复）。退出后清空凭证并回到登录屏。
 */
export default function MeAccountScreen() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(() => detectLang());
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const [pushEnabled, setPushEnabled] = useState<boolean>(
    () => kv.get<boolean>(PUSH_KEY) ?? DEMO_SETTINGS_VIEW.account.pushEnabled,
  );
  const [confirmKind, setConfirmKind] = useState<'logout' | 'delete' | null>(null);

  const selectLang = (next: Lang) => {
    setLang(next);
    kv.set('lang', next);
  };

  const togglePush = (next: boolean) => {
    setPushEnabled(next);
    kv.set(PUSH_KEY, next);
  };

  const performSignOut = () => {
    setConfirmKind(null);
    session.clear();
    router.replace('/login');
  };

  return (
    <View style={styles.root} testID="me-account-screen">
      <Header title={tMe(lang, 'account.title')} back />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          <View style={styles.card}>
            <View style={[styles.row, styles.rowBorder]}>
              <Text style={styles.rowLabel}>{tMe(lang, 'account.email')}</Text>
              <Text style={styles.rowValue} testID="account-email">
                {DEMO_SETTINGS_VIEW.account.email}
              </Text>
            </View>

            <View style={[styles.row, styles.rowBorder]}>
              <Text style={styles.rowLabel}>{tMe(lang, 'account.language')}</Text>
              <View style={styles.langRow}>
                {(['zh', 'en'] as const).map((code) => {
                  const active = lang === code;
                  return (
                    <Pressable
                      key={code}
                      onPress={() => selectLang(code)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      testID={`account-lang-${code}`}
                      style={[styles.langChip, active && styles.langChipActive]}
                    >
                      <Text style={[styles.langText, active && styles.langTextActive]}>
                        {tMe(lang, code === 'zh' ? 'account.langZh' : 'account.langEn')}
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
              onPress={() => setConfirmKind('logout')}
              accessibilityRole="button"
              testID="account-logout"
              style={({ pressed }) => [styles.actionRow, styles.rowBorder, pressed && styles.pressed]}
            >
              <Text style={styles.actionText}>{tMe(lang, 'account.logout')}</Text>
            </Pressable>
            <Pressable
              onPress={() => setConfirmKind('delete')}
              accessibilityRole="button"
              testID="account-delete"
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            >
              <Text style={styles.dangerText}>{tMe(lang, 'account.delete')}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <ConfirmSheet
        open={confirmKind === 'logout'}
        onClose={() => setConfirmKind(null)}
        title={tMe(lang, 'account.logoutTitle')}
        description={tMe(lang, 'account.logoutBody')}
        confirmLabel={tMe(lang, 'account.logoutConfirm')}
        cancelLabel={tMe(lang, 'account.cancel')}
        onConfirm={performSignOut}
        testID="account-logout-confirm"
      />

      <ConfirmSheet
        open={confirmKind === 'delete'}
        onClose={() => setConfirmKind(null)}
        title={tMe(lang, 'account.deleteTitle')}
        description={tMe(lang, 'account.deleteBody')}
        confirmLabel={tMe(lang, 'account.deleteConfirm')}
        cancelLabel={tMe(lang, 'account.cancel')}
        onConfirm={performSignOut}
        testID="account-delete-confirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
  langRow: { flexDirection: 'row', gap: space[2] },
  langChip: {
    paddingHorizontal: space[3],
    paddingVertical: 6,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.sunken,
  },
  langChipActive: {
    borderColor: color.primary,
    backgroundColor: color.card,
  },
  langText: { ...type.caption, color: color.text2 },
  langTextActive: { color: color.text, fontWeight: '600' },
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
  pressed: { backgroundColor: color.press },
  actionText: { ...type.callout, fontWeight: '500', color: color.text },
  dangerText: { ...type.callout, fontWeight: '600', color: color.error },
});
