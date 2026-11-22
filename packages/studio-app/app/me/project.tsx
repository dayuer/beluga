import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { ProjectSettingsSheet, type ProjectDeliveryMode } from '../../components/ProjectSettingsSheet';
import { Skeleton } from '../../components/Skeleton';
import { SyncBanner } from '../../components/SyncBanner';
import { TextButton } from '../../components/TextButton';
import { useScheme } from '../../lib/appearance';
import { phoneSettingsEnabled } from '../../lib/phone-settings-flag';
import { useSettingsView } from '../../lib/settings-source';
import { detectLang, t, type Lang } from '../../lib/strings';
import { tMe } from '../../lib/strings/me';
import { color, radius, space, type } from '../../lib/theme';

export type DeliveryMode = ProjectDeliveryMode;

/** 区分三种代码交付方式，各自显示客户看得懂的说明。 */
export function deliveryModeLabel(mode: DeliveryMode | undefined, lang: Lang): string {
  switch (mode) {
    case 'push-mine':
      return tMe(lang, 'project.deliveryPushMine');
    case 'repo':
      return tMe(lang, 'project.deliveryRepo');
    case 'preview-only':
    default:
      return tMe(lang, 'project.deliveryPreviewOnly');
  }
}

function InfoRow({
  label,
  value,
  last,
  styles,
}: {
  readonly label: string;
  readonly value: string;
  readonly last?: boolean;
  readonly styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * 我 › 项目与代码交付（只读，SS-57 / SS-201）：
 * 分清 preview-only / repo / push-mine 三种交付方式；颜色在渲染时读取以跟随深色模式。
 */
export default function MeProjectScreen() {
  useScheme();
  const styles = createStyles();
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const { data: settings, loading, offline } = useSettingsView();
  const { projects, forges } = settings;

  // 手机改项目设置（SS-228）：开关关掉时入口不出现，卡片回到只读。
  const canEditSettings = phoneSettingsEnabled();
  const [saved, setSaved] = useState<Record<string, { mode: DeliveryMode; repoUrl?: string }>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const editingProject = editing ? projects.find((p) => p.id === editing) : undefined;
  const editingForge = editingProject ? forges.find((f) => f.projectId === editingProject.id) : undefined;
  const editingPatch = editingProject ? saved[editingProject.id] : undefined;
  const editingMode: DeliveryMode = editingPatch?.mode ?? (editingForge?.mode as DeliveryMode | undefined) ?? 'preview-only';
  const editingRepoUrl = editingPatch ? editingPatch.repoUrl : editingForge?.repoUrl;

  return (
    <View style={styles.root} testID="me-project-screen">
      <Header title={tMe(lang, 'project.title')} back />
      {offline ? (
        <SyncBanner kind="offline" text={t(lang, 'common.offline')} testID="offline-banner" />
      ) : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {loading ? (
            <View testID="project-skeleton">
              <Skeleton count={3} />
            </View>
          ) : projects.length === 0 ? (
            <EmptyState title={tMe(lang, 'project.empty')} testID="project-empty" />
          ) : (
            <View style={styles.list}>
              {projects.map((proj) => {
                const forge = forges.find((f) => f.projectId === proj.id);
                const runModeLabel =
                  proj.runMode === 'auto-delivery'
                    ? tMe(lang, 'project.runAuto')
                    : tMe(lang, 'project.runEveryStep');
                // 刚在本机保存过的设置先显示；视图刷新后仍以节点为准。
                const patch = saved[proj.id];
                const mode: DeliveryMode = patch?.mode ?? (forge?.mode as DeliveryMode | undefined) ?? 'preview-only';
                const repoUrl = patch ? patch.repoUrl : forge?.repoUrl;
                const deliveryLabel = deliveryModeLabel(mode, lang);

                return (
                  <View key={proj.id} style={styles.card} testID={`project-card-${proj.id}`}>
                    <Text style={styles.cardTitle}>{proj.name}</Text>
                    <View style={styles.rows}>
                      <InfoRow label={tMe(lang, 'project.platform')} value={proj.platform} styles={styles} />
                      <InfoRow label={tMe(lang, 'project.runMode')} value={runModeLabel} styles={styles} />
                      <InfoRow
                        label={tMe(lang, 'project.deliveryMode')}
                        value={deliveryLabel}
                        last={!repoUrl && !(forge?.hasToken ?? false)}
                        styles={styles}
                      />
                      {repoUrl ? (
                        <InfoRow
                          label={tMe(lang, 'project.repo')}
                          value={repoUrl}
                          last={forge?.hasToken === undefined}
                          styles={styles}
                        />
                      ) : null}
                      {forge ? (
                        <View style={styles.tokenRow}>
                          <Text style={styles.tokenText}>
                            {forge.hasToken
                              ? tMe(lang, 'project.tokenSet')
                              : tMe(lang, 'project.tokenMissing')}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {canEditSettings ? (
                      <View style={styles.editRow}>
                        <TextButton
                          label={tMe(lang, 'project.edit')}
                          onPress={() => setEditing(proj.id)}
                          testID={`project-settings-${proj.id}`}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.footerBox}>
            <Text style={styles.footerText}>
              {tMe(lang, canEditSettings ? 'project.mobileNote' : 'env.desktopNote')}
            </Text>
          </View>
        </View>
      </ScrollView>

      {canEditSettings && editingProject ? (
        <ProjectSettingsSheet
          open
          onClose={() => setEditing(null)}
          projectId={editingProject.id}
          projectName={editingProject.name}
          initialMode={editingMode}
          initialRepoUrl={editingRepoUrl}
          lang={lang}
          onSaved={(mode, repoUrl) =>
            setSaved((prev) => ({ ...prev, [editingProject.id]: { mode, repoUrl } }))
          }
          testID="project-settings-sheet"
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
    list: { gap: space[4] },
    card: {
      backgroundColor: color.card,
      borderRadius: radius.l,
      borderWidth: 1,
      borderColor: color.hairline,
      overflow: 'hidden',
    },
    cardTitle: {
      ...type.heading,
      color: color.text,
      paddingHorizontal: space[4],
      paddingTop: space[4],
      paddingBottom: space[3],
    },
    rows: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: color.hairline,
    },
    row: {
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
    rowLabel: { ...type.callout, color: color.text2 },
    rowValue: { ...type.callout, color: color.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
    tokenRow: {
      paddingHorizontal: space[4],
      paddingVertical: space[2],
      backgroundColor: color.sunken,
    },
    tokenText: { ...type.caption, color: color.text3OnSunken },
    editRow: {
      alignItems: 'flex-end',
      paddingHorizontal: space[4],
      paddingVertical: space[2],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: color.hairline,
    },
    footerBox: {
      marginTop: space[5],
      backgroundColor: color.sunken,
      borderRadius: radius.m,
      paddingHorizontal: space[4],
      paddingVertical: space[3],
    },
    footerText: { ...type.caption, color: color.text3OnSunken, textAlign: 'center' },
  });
