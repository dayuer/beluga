import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProjectCardData } from '../lib/cards';
import { detectLang, t } from '../lib/strings';
import { ago } from '../lib/time';
import { color, radius, space, type } from '../lib/theme';

/** One project: its name and studio, the latest plan's line, a dot when the customer is needed,
 * and the studio's offline line. No platform icons in M5: the hub has no platform field yet. */
export function ProjectCard({ project, onPress, testID, fill = false, todoDot = false }: { project: ProjectCardData; onPress: () => void; testID?: string; fill?: boolean; todoDot?: boolean }) {
  const lang = detectLang();
  const line = project.plansLoading
    ? t(lang, 'projects.plansLoading')
    : project.plansKnown
      ? (project.headline ?? t(lang, 'projects.noPlans'))
      : t(lang, 'projects.plansUnavailable');
  const offline = project.studio !== undefined && !project.studio.online;
  const offlineText =
    project.studio?.lastSyncAt != null
      ? t(lang, 'common.studioOffline', { ago: ago(project.studio.lastSyncAt, lang) })
      : t(lang, 'common.studioOfflineShort');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${project.name}, ${project.studioName}${todoDot ? `, ${t(lang, 'todo.dotLabel')}` : ''}`}
      testID={testID ?? `project-card-${project.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, fill && styles.fill, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <Text style={styles.name} numberOfLines={1}>
          {project.name}
        </Text>
        {todoDot ? <View style={styles.todoDot} testID="project-dot" /> : null}
        <Text style={styles.studio} numberOfLines={1}>
          {project.studioName}
        </Text>
      </View>
      <Text style={styles.line} numberOfLines={1}>
        {line}
      </Text>
      {project.waiting ? (
        <View style={styles.status}>
          <View style={styles.dot} />
          <Text style={styles.waiting}>{t(lang, 'home.waitingYou')}</Text>
        </View>
      ) : null}
      {offline ? (
        <View style={styles.status}>
          <Text style={styles.offline}>{offlineText}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: radius.l,
    padding: space[5],
    width: '100%',
    shadowColor: color.shadowInk,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
  },
  fill: { flexGrow: 1 },
  pressed: { backgroundColor: '#FBFBFC' },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: space[3] },
  name: { ...type.heading, color: color.text, flex: 1 },
  todoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.info },
  studio: { ...type.caption, color: color.text3, maxWidth: '46%' },
  line: { ...type.callout, color: color.text2, marginTop: space[2] },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space[3] },
  dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: color.warn },
  waiting: { ...type.caption, color: color.warn, fontWeight: '500' },
  offline: { ...type.caption, color: color.warn },
});
