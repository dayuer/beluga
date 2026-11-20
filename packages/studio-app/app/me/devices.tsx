import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { Skeleton } from '../../components/Skeleton';
import { SyncBanner } from '../../components/SyncBanner';
import { useScheme } from '../../lib/appearance';
import { useHasDeviceKey } from '../../lib/keys';
import { useSettingsView } from '../../lib/settings-source';
import { detectLang, t } from '../../lib/strings';
import { tMe } from '../../lib/strings/me';
import { ago } from '../../lib/time';
import { color, radius, space, type } from '../../lib/theme';
import type { SettingsView } from '../../lib/views';

type RegisteredDevice = SettingsView['devices'][number];

/**
 * 我 › 设备（列表与移除，SS-58 / SS-200）：
 * - 已登记设备（名字、类型、登记时间各一列，标出「这台」）；
 * - 行内「移除」为文字按钮（无密钥时禁用并说明），整屏只有 ConfirmSheet 使用实底主按钮，且按钮写动作名「移除设备」；
 * - 「加一台设备」行去 /me/devices/add（A6 实现）。
 */
export default function MeDevicesScreen() {
  useScheme();
  const styles = createStyles();
  const router = useRouter();
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const { hasKey } = useHasDeviceKey();

  const { data: settings, loading, offline } = useSettingsView();
  const [devices, setDevices] = useState<readonly RegisteredDevice[]>(() => settings.devices);
  useEffect(() => {
    setDevices(settings.devices);
  }, [settings.devices]);
  const [pendingRemove, setPendingRemove] = useState<RegisteredDevice | null>(null);

  const confirmRemove = () => {
    if (!pendingRemove || !hasKey) return;
    setDevices((prev) => prev.filter((d) => d.id !== pendingRemove.id));
    setPendingRemove(null);
  };

  return (
    <View style={styles.root} testID="me-devices-screen">
      <Header title={tMe(lang, 'devices.title')} back />
      {offline ? (
        <SyncBanner kind="offline" text={t(lang, 'common.offline')} testID="offline-banner" />
      ) : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {loading ? (
            <View testID="devices-skeleton">
              <Skeleton count={3} />
            </View>
          ) : devices.length === 0 ? (
            <EmptyState title={tMe(lang, 'devices.empty')} testID="devices-empty" />
          ) : (
            <>
              <View style={styles.tableCard} testID="devices-table">
                <View style={[styles.row, styles.headerRow]}>
                  <Text style={[styles.colHeader, styles.colName]}>{tMe(lang, 'devices.colName')}</Text>
                  <Text style={[styles.colHeader, styles.colType]}>{tMe(lang, 'devices.colType')}</Text>
                  <Text style={[styles.colHeader, styles.colTime]}>{tMe(lang, 'devices.colTime')}</Text>
                </View>
                {devices.map((dev, idx) => (
                  <View
                    key={dev.id}
                    testID={`device-row-${dev.id}`}
                    style={[styles.deviceBlock, idx < devices.length - 1 && styles.rowBorder]}
                  >
                    <View style={styles.row}>
                      <View style={[styles.colName, styles.nameCell]}>
                        <Text style={styles.nameText} numberOfLines={1}>
                          {dev.name}
                        </Text>
                        {dev.isCurrent ? (
                          <View style={styles.currentBadge} testID={`device-current-${dev.id}`}>
                            <Text style={styles.currentBadgeText}>{tMe(lang, 'devices.current')}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.cellText, styles.colType]} numberOfLines={1}>
                        {dev.platform}
                      </Text>
                      <Text style={[styles.cellText, styles.colTime]} numberOfLines={1}>
                        {ago(dev.registeredAt, lang)}
                      </Text>
                    </View>

                    {!dev.isCurrent ? (
                      <View style={styles.removeWrap}>
                        <Pressable
                          onPress={() => setPendingRemove(dev)}
                          disabled={!hasKey}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: !hasKey }}
                          testID={`device-remove-${dev.id}`}
                          style={({ pressed }) => [
                            styles.removeTextBtn,
                            !hasKey && styles.removeDisabled,
                            pressed && hasKey && styles.pressed,
                          ]}
                        >
                          <Text style={styles.removeText}>{tMe(lang, 'devices.remove')}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
              {!hasKey ? (
                <Text style={styles.noKeyHint} testID="devices-no-key-hint">
                  {tMe(lang, 'devices.noKeyHint')}
                </Text>
              ) : null}
            </>
          )}

          <Pressable
            onPress={() => router.push('/me/devices/add' as never)}
            accessibilityRole="button"
            testID="devices-add"
            style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
          >
            <Text style={styles.addLabel}>{tMe(lang, 'devices.add')}</Text>
            <ChevronRight size={16} color={color.text3} />
          </Pressable>
        </View>
      </ScrollView>

      <ConfirmSheet
        open={Boolean(pendingRemove)}
        onClose={() => setPendingRemove(null)}
        title={
          pendingRemove
            ? tMe(lang, 'devices.removeTitle', { name: pendingRemove.name })
            : ''
        }
        description={tMe(lang, 'devices.removeBody')}
        confirmLabel={tMe(lang, 'devices.removeConfirm')}
        cancelLabel={tMe(lang, 'devices.cancel')}
        onConfirm={confirmRemove}
        testID="device-remove-confirm"
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
  tableCard: {
    backgroundColor: color.card,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: color.hairline,
    overflow: 'hidden',
  },
  deviceBlock: {
    paddingBottom: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[2],
  },
  headerRow: {
    backgroundColor: color.sunken,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  colHeader: { ...type.caption, fontWeight: '600', color: color.text3 },
  colName: { flex: 2, minWidth: 0 },
  colType: { flex: 1, textAlign: 'center' },
  colTime: { flex: 1, textAlign: 'right' },
  nameCell: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  nameText: { ...type.callout, fontWeight: '500', color: color.text },
  currentBadge: {
    backgroundColor: color.sunken,
    borderRadius: radius.s,
    paddingHorizontal: space[2],
    paddingVertical: 2,
  },
  currentBadgeText: { ...type.caption, color: color.text2, fontWeight: '500' },
  cellText: { ...type.caption, color: color.text2 },
  removeWrap: {
    paddingHorizontal: space[4],
    paddingBottom: space[1],
    alignItems: 'flex-start',
  },
  removeTextBtn: {
    minHeight: 44,
    paddingHorizontal: space[2],
    justifyContent: 'center',
  },
  removeDisabled: { opacity: 0.45 },
  removeText: { ...type.callout, color: color.error, fontWeight: '500' },
  noKeyHint: { ...type.caption, color: color.text3, marginTop: space[3], paddingHorizontal: space[1] },
  addRow: {
    marginTop: space[5],
    minHeight: 48,
    backgroundColor: color.card,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pressed: { backgroundColor: color.press },
  addLabel: { ...type.callout, fontWeight: '500', color: color.text },
});
