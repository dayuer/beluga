import { StyleSheet, Text, View } from 'react-native';
import type { StudioMilestone, StudioPlanView } from '../../../src/studio/protocol';
import { t, type Lang } from '../lib/strings';
import { color, radius, space, type } from '../lib/theme';

interface AcceptCardProps {
  readonly milestone: StudioMilestone;
  readonly review: StudioPlanView['review'];
  readonly lang: Lang;
}

/** What is being approved, in the review phase: the milestone, its criteria and the checker's note. */
export function AcceptCard({ milestone, review, lang }: AcceptCardProps) {
  const notes = review?.milestoneRef === milestone.ref ? review.notes.trim() : '';
  return (
    <View style={styles.card} testID="accept-card">
      <Text style={styles.eyebrow}>{t(lang, 'review.title')}</Text>
      <Text style={styles.title}>{milestone.title}</Text>
      {milestone.criteria.length ? (
        <View style={styles.criteria}>
          {milestone.criteria.map((c) => (
            <Text key={c} style={styles.text}>
              ◦ {c}
            </Text>
          ))}
        </View>
      ) : null}
      {notes ? (
        <View style={styles.notes}>
          <Text style={styles.label}>{t(lang, 'review.notes')}</Text>
          <Text style={styles.text}>{notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.card, borderRadius: radius.l, borderWidth: 1, borderColor: color.hairlineStrong, padding: space[5], gap: space[3] },
  eyebrow: { ...type.eyebrow, color: color.text3 },
  title: { ...type.heading, color: color.text },
  criteria: { gap: space[1] },
  text: { ...type.callout, color: color.text2 },
  notes: { gap: space[1], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline, paddingTop: space[3] },
  label: { ...type.caption, color: color.text2, fontWeight: '600' },
});
