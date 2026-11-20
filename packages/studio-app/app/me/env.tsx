import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { SecretSheet } from '../../components/SecretSheet';
import { Segments, type SegmentItem } from '../../components/Segments';
import { Skeleton } from '../../components/Skeleton';
import { SyncBanner } from '../../components/SyncBanner';
import { TextButton } from '../../components/TextButton';
import { useScheme } from '../../lib/appearance';
import { resolveNodeSealKey } from '../../lib/node-seal-key';
import { phoneSettingsEnabled } from '../../lib/phone-settings-flag';
import { useSettingsView } from '../../lib/settings-source';
import { detectLang, t } from '../../lib/strings';
import { tMe } from '../../lib/strings/me';
import { ago } from '../../lib/time';
import { color, radius, space, type } from '../../lib/theme';

interface EnvTableRow {
  readonly key: string;
  readonly name: string;
  readonly kind: 'var' | 'secret';
  readonly purpose?: string;
  readonly at: number;
  readonly byName: string;
  readonly staleDays?: number;
  /** 有没有填过：没填过的按钮写「填写」。 */
  readonly filled?: boolean;
}

const ENV_TABS: readonly {
  readonly key: 'test' | 'staging' | 'prod';
  readonly labelKey: 'env.tabTest' | 'env.tabStaging' | 'env.tabProd';
}[] = [
  { key: 'test', labelKey: 'env.tabTest' },
  { key: 'staging', labelKey: 'env.tabStaging' },
  { key: 'prod', labelKey: 'env.tabProd' },
];

/**
 * 我 › 环境与密钥（只读，SS-55 / SS-201）：
 * 支持切换项目；测试 / 预发 / 正式分段；变量与密钥合并成一张表，
 * 密钥显示用途但不显示值；底部灰底说明使用 color.text3OnSunken，颜色跟随深色模式。
 */
export default function MeEnvScreen() {
  useScheme();
  const styles = createStyles();
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const { data: settings, loading, offline } = useSettingsView();
  const [selectedPid, setSelectedPid] = useState<string>(() => settings.projects[0]?.id ?? '');

  useEffect(() => {
    if (settings.projects.length === 0) return;
    setSelectedPid((cur) =>
      cur && settings.projects.some((p) => p.id === cur) ? cur : settings.projects[0]!.id,
    );
  }, [settings.projects]);

  const project = settings.projects.find((p) => p.id === selectedPid) ?? settings.projects[0];
  const projectEnvs = project ? (settings.envs[project.id] ?? []) : [];

  const [envTab, setEnvTab] = useState<'test' | 'staging' | 'prod'>('test');

  const segmentItems: readonly SegmentItem[] = useMemo(
    () =>
      ENV_TABS.map((tab) => ({
        key: tab.key,
        label: tMe(lang, tab.labelKey),
        testID: `env-tab-${tab.key}`,
      })),
    [lang],
  );

  const activeEnv = projectEnvs.find((e) => e.id === envTab);

  // 手机临时填密钥（SS-227）：开关关掉时两个入口都不出现，页面回到只读。
  const canEditSecrets = phoneSettingsEnabled();
  const nodeSealKey = useMemo(() => resolveNodeSealKey(settings), [settings]);

  /** 本机刚保存成功的密钥：先把列表上的时间与更新人换掉，等视图刷新再以节点为准。 */
  const [saved, setSaved] = useState<Record<string, { at: number; byName: string }>>({});
  const [editing, setEditing] = useState<{ name: string; purpose: string } | null>(null);

  const rows: EnvTableRow[] = useMemo(() => {
    if (!activeEnv) return [];
    const list: EnvTableRow[] = [];
    for (const v of activeEnv.vars) {
      list.push({
        key: `var:${v.name}`,
        name: v.name,
        kind: 'var',
        at: v.at,
        byName: v.by.name,
      });
    }
    for (const s of activeEnv.secrets) {
      const local = saved[`${project?.id}:${envTab}:${s.name}`];
      list.push({
        key: `secret:${s.name}`,
        name: s.name,
        kind: 'secret',
        purpose: s.purpose,
        at: local?.at ?? s.at,
        byName: local?.byName ?? s.by.name,
        staleDays: local ? undefined : s.staleDays,
        filled: (local?.at ?? s.at) > 0,
      });
    }
    return list;
  }, [activeEnv, saved, project?.id, envTab]);

  return (
    <View style={styles.root} testID="me-env-screen">
      <Header title={tMe(lang, 'env.title')} back />
      <Segments
        items={segmentItems}
        value={envTab}
        onChange={(k) => setEnvTab(k as 'test' | 'staging' | 'prod')}
      />
      {offline ? (
        <SyncBanner kind="offline" text={t(lang, 'common.offline')} testID="offline-banner" />
      ) : null}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {settings.projects.length > 1 ? (
            <View style={styles.projectRow} testID="env-project-picker">
              {settings.projects.map((p) => {
                const selected = p.id === project?.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setSelectedPid(p.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    testID={`env-project-${p.id}`}
                    style={({ pressed }) => [
                      styles.projectChip,
                      selected && styles.projectChipSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.projectChipText, selected && styles.projectChipTextSelected]}>
                      {p.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {project ? (
            <Text style={styles.projectName}>
              {project.name}
              {activeEnv ? ` · ${activeEnv.target.mode}` : ''}
            </Text>
          ) : null}

          {loading ? (
            <View testID="env-skeleton">
              <Skeleton count={3} />
            </View>
          ) : rows.length === 0 ? (
            <EmptyState title={tMe(lang, 'env.empty')} testID="env-empty" />
          ) : (
            <View style={styles.tableCard} testID="env-table">
              <View style={[styles.row, styles.headerRow]}>
                <Text style={[styles.colHeader, styles.colName]}>{tMe(lang, 'env.colName')}</Text>
                <Text style={[styles.colHeader, styles.colTime]}>{tMe(lang, 'env.colTime')}</Text>
                <Text style={[styles.colHeader, styles.colBy]}>{tMe(lang, 'env.colBy')}</Text>
                {canEditSecrets ? (
                  <Text style={[styles.colHeader, styles.colActionHeader]}>{tMe(lang, 'env.colAction')}</Text>
                ) : null}
              </View>
              {rows.map((row, idx) => (
                <View
                  key={row.key}
                  testID={`env-row-${row.name}`}
                  style={[styles.row, idx < rows.length - 1 && styles.rowBorder]}
                >
                  <View style={styles.colName}>
                    <Text style={styles.nameText} numberOfLines={1}>
                      {row.name}
                    </Text>
                    {row.purpose ? (
                      <Text style={styles.purposeText} testID={`env-purpose-${row.name}`}>
                        {row.purpose}
                      </Text>
                    ) : null}
                    {row.staleDays ? (
                      <Text style={styles.staleText}>
                        {tMe(lang, 'env.stale', { days: row.staleDays })}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.cellText, styles.colTime]} numberOfLines={1} testID={`env-time-${row.name}`}>
                    {ago(row.at, lang)}
                  </Text>
                  <Text style={[styles.cellText, styles.colBy]} numberOfLines={1}>
                    {row.byName}
                  </Text>
                  {canEditSecrets ? (
                    <View style={styles.colAction}>
                      {row.kind === 'secret' ? (
                        <TextButton
                          label={tMe(lang, row.filled ? 'env.secretUpdate' : 'env.secretFill')}
                          onPress={() => setEditing({ name: row.name, purpose: row.purpose ?? '' })}
                          testID={`env-secret-${row.name}`}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          <View style={styles.footerBox} testID="env-desktop-note">
            <Text style={styles.footerText}>
              {tMe(lang, canEditSecrets ? 'env.mobileNote' : 'env.desktopNote')}
            </Text>
          </View>
        </View>
      </ScrollView>

      {canEditSecrets && project ? (
        <SecretSheet
          open={editing !== null}
          onClose={() => setEditing(null)}
          projectId={project.id}
          envId={envTab}
          name={editing?.name ?? ''}
          purpose={editing?.purpose ?? ''}
          nodeSealKey={nodeSealKey}
          lang={lang}
          onSaved={() => {
            if (!editing) return;
            setSaved((prev) => ({
              ...prev,
              [`${project.id}:${envTab}:${editing.name}`]: {
                at: Date.now(),
                byName: tMe(lang, 'env.byThisDevice'),
              },
            }));
          }}
          testID="secret-sheet"
        />
      ) : null}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: color.bg },
    scroll: { flex: 1 },
    content: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[7] },
    column: { flex: 1, width: '100%' },
    columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
    projectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
    projectChip: {
      minHeight: 44,
      paddingHorizontal: space[3],
      borderRadius: radius.m,
      borderWidth: 1,
      borderColor: color.hairline,
      backgroundColor: color.card,
      justifyContent: 'center',
    },
    projectChipSelected: { borderColor: color.primary, backgroundColor: color.sunken },
    projectChipText: { ...type.callout, color: color.text2 },
    projectChipTextSelected: { color: color.text, fontWeight: '600' },
    pressed: { backgroundColor: color.press },
    projectName: { ...type.caption, fontWeight: '600', color: color.text3, marginBottom: space[3] },
    tableCard: {
      backgroundColor: color.card,
      borderRadius: radius.l,
      borderWidth: 1,
      borderColor: color.hairline,
      overflow: 'hidden',
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
    colTime: { flex: 1, textAlign: 'right' },
    colBy: { flex: 1, textAlign: 'right' },
    colAction: { width: 64, alignItems: 'flex-end' },
    colActionHeader: { width: 64, textAlign: 'right' },
    nameText: { ...type.callout, fontWeight: '500', color: color.text },
    purposeText: { ...type.caption, color: color.text3, marginTop: 2 },
    staleText: { ...type.caption, color: color.warn, marginTop: 2 },
    cellText: { ...type.caption, color: color.text2 },
    footerBox: {
      marginTop: space[5],
      backgroundColor: color.sunken,
      borderRadius: radius.m,
      paddingHorizontal: space[4],
      paddingVertical: space[3],
    },
    footerText: {
      ...type.caption,
      color: color.text3OnSunken,
      textAlign: 'center',
    },
  });
