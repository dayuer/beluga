import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { DEMO_SETTINGS_VIEW } from '../../lib/demo';
import { detectLang } from '../../lib/strings';
import { tMe } from '../../lib/strings/me';
import { color, radius, space, type } from '../../lib/theme';

function InfoRow({
  label,
  value,
  last,
}: {
  readonly label: string;
  readonly value: string;
  readonly last?: boolean;
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
 * 我 › 项目与代码交付（只读，SS-57）：
 * 展示每个项目的平台、运行方式、代码交付方式与仓库地址（不显示令牌内容）。
 */
export default function MeProjectScreen() {
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const { projects, forges } = DEMO_SETTINGS_VIEW;

  return (
    <View style={styles.root} testID="me-project-screen">
      <Header title={tMe(lang, 'project.title')} back />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {projects.length === 0 ? (
            <EmptyState title={tMe(lang, 'project.empty')} testID="project-empty" />
          ) : (
            <View style={styles.list}>
              {projects.map((proj) => {
                const forge = forges.find((f) => f.projectId === proj.id);
                const runModeLabel =
                  proj.runMode === 'auto-delivery'
                    ? tMe(lang, 'project.runAuto')
                    : tMe(lang, 'project.runEveryStep');
                const deliveryLabel =
                  forge?.mode === 'push-mine'
                    ? tMe(lang, 'project.deliveryPushMine')
                    : tMe(lang, 'project.deliveryManaged');

                return (
                  <View key={proj.id} style={styles.card} testID={`project-card-${proj.id}`}>
                    <Text style={styles.cardTitle}>{proj.name}</Text>
                    <View style={styles.rows}>
                      <InfoRow label={tMe(lang, 'project.platform')} value={proj.platform} />
                      <InfoRow label={tMe(lang, 'project.runMode')} value={runModeLabel} />
                      <InfoRow
                        label={tMe(lang, 'project.deliveryMode')}
                        value={deliveryLabel}
                        last={!forge?.repoUrl && !forge?.hasToken}
                      />
                      {forge?.repoUrl ? (
                        <InfoRow
                          label={tMe(lang, 'project.repo')}
                          value={forge.repoUrl}
                          last={forge.hasToken === undefined}
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
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.footerBox}>
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
  tokenText: { ...type.caption, color: '#6A6A70' },
  footerBox: {
    marginTop: space[5],
    backgroundColor: color.sunken,
    borderRadius: radius.m,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  footerText: { ...type.caption, color: '#6A6A70', textAlign: 'center' },
});
