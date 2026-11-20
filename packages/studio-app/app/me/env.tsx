import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { Segments, type SegmentItem } from '../../components/Segments';
import { DEMO_SETTINGS_VIEW } from '../../lib/demo';
import { detectLang } from '../../lib/strings';
import { tMe } from '../../lib/strings/me';
import { ago } from '../../lib/time';
import { color, radius, space, type } from '../../lib/theme';

interface EnvTableRow {
  readonly key: string;
  readonly name: string;
  readonly kind: 'var' | 'secret';
  readonly at: number;
  readonly byName: string;
  readonly staleDays?: number;
}

const ENV_TABS: readonly { readonly key: 'test' | 'staging' | 'prod'; readonly labelZh: string; readonly labelEn: string }[] = [
  { key: 'test', labelZh: '测试', labelEn: 'Test' },
  { key: 'staging', labelZh: '预发', labelEn: 'Staging' },
  { key: 'prod', labelZh: '正式', labelEn: 'Prod' },
];

/**
 * 我 › 环境与密钥（只读，SS-55）：
 * 测试 / 预发 / 正式分段；变量与密钥合并成一张表，名字、更新时间、更新人分三列，不显示值；
 * 底部灰底说明「填和换在桌面上做」（#6A6A70）。
 */
export default function MeEnvScreen() {
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const project = DEMO_SETTINGS_VIEW.projects[0];
  const projectEnvs = project ? (DEMO_SETTINGS_VIEW.envs[project.id] ?? []) : [];

  const [envTab, setEnvTab] = useState<'test' | 'staging' | 'prod'>('test');

  const segmentItems: readonly SegmentItem[] = useMemo(
    () =>
      ENV_TABS.map((tab) => ({
        key: tab.key,
        label: lang === 'en' ? tab.labelEn : tab.labelZh,
        testID: `env-tab-${tab.key}`,
      })),
    [lang],
  );

  const activeEnv = projectEnvs.find((e) => e.id === envTab);

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
      list.push({
        key: `secret:${s.name}`,
        name: s.name,
        kind: 'secret',
        at: s.at,
        byName: s.by.name,
        staleDays: s.staleDays,
      });
    }
    return list;
  }, [activeEnv]);

  return (
    <View style={styles.root} testID="me-env-screen">
      <Header title={tMe(lang, 'env.title')} back />
      <Segments items={segmentItems} value={envTab} onChange={(k) => setEnvTab(k as 'test' | 'staging' | 'prod')} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {project ? (
            <Text style={styles.projectName}>
              {project.name}
              {activeEnv ? ` · ${activeEnv.target.mode}` : ''}
            </Text>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState title={tMe(lang, 'env.empty')} testID="env-empty" />
          ) : (
            <View style={styles.tableCard} testID="env-table">
              <View style={[styles.row, styles.headerRow]}>
                <Text style={[styles.colHeader, styles.colName]}>{tMe(lang, 'env.colName')}</Text>
                <Text style={[styles.colHeader, styles.colTime]}>{tMe(lang, 'env.colTime')}</Text>
                <Text style={[styles.colHeader, styles.colBy]}>{tMe(lang, 'env.colBy')}</Text>
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
                    {row.staleDays ? (
                      <Text style={styles.staleText}>
                        {tMe(lang, 'env.stale', { days: row.staleDays })}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.cellText, styles.colTime]} numberOfLines={1}>
                    {ago(row.at, lang)}
                  </Text>
                  <Text style={[styles.cellText, styles.colBy]} numberOfLines={1}>
                    {row.byName}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.footerBox} testID="env-desktop-note">
            <Text style={styles.footerText}>{tMe(lang, 'env.desktopNote')}</Text>
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
  nameText: { ...type.callout, fontWeight: '500', color: color.text },
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
    color: '#6A6A70',
    textAlign: 'center',
  },
});
