import { StyleSheet, Text, View } from 'react-native';
import { t, type Lang } from '../lib/strings';
import { color, space, type } from '../lib/theme';
import { ago } from '../lib/time';

interface ActivityListProps {
  readonly activity: readonly { readonly at: number; readonly text: string }[];
  readonly lang: Lang;
}

/** What the plan has been doing: newest first, quiet, no taps (M6 §4.6). */
export function ActivityList({ activity, lang }: ActivityListProps) {
  if (activity.length === 0) {
    return (
      <View style={styles.empty} testID="activity-empty">
        <Text style={styles.emptyTitle}>{t(lang, 'plan.activityEmpty')}</Text>
        <Text style={styles.emptyBody}>{t(lang, 'plan.activityEmptyBody')}</Text>
      </View>
    );
  }
  return (
    <View style={styles.root} testID="activity-list">
      {[...activity].reverse().map((row, i) => (
        <View key={`${row.at}-${i}`} style={styles.row}>
          <Text style={styles.time}>{ago(row.at, lang)}</Text>
          <Text style={styles.text} numberOfLines={3}>
            {row.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: space[5], paddingVertical: space[3] },
  row: { flexDirection: 'row', gap: space[3], paddingVertical: space[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.hairline },
  time: { ...type.caption, color: color.text3, width: 64, paddingTop: 1 },
  text: { ...type.callout, color: color.text, flex: 1 },
  empty: { paddingHorizontal: space[6], paddingVertical: space[7], alignItems: 'center', gap: space[2] },
  emptyTitle: { ...type.heading, color: color.text },
  emptyBody: { ...type.callout, color: color.text2, textAlign: 'center' },
});
