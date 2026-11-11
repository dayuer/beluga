import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { StudioMilestone } from '../../../../src/studio/protocol';
import { milestoneStatusKey, milestoneTone } from '../../lib/plan-graph';
import { t, type Lang } from '../../lib/strings';
import { color, radius, space, type } from '../../lib/theme';
import { useKeyboardInset } from '../../lib/viewport';

interface MilestoneSheetProps {
  readonly milestone: StudioMilestone;
  readonly lang: Lang;
  readonly onClose: () => void;
  /** The dock's height plus the safe area: the sheet ends above it, so the primary stays tappable. */
  readonly bottomInset?: number;
}

/**
 * A milestone's details, in a sheet above the action dock (M6 §4.4): no scrim and no covering of
 * the primary button. It scrolls on its own, up to 60% of what the keyboard leaves.
 */
export function MilestoneSheet({ milestone, lang, onClose, bottomInset = 8 }: MilestoneSheetProps) {
  const { height } = useWindowDimensions();
  const keyboard = useKeyboardInset();
  const maxHeight = Math.max(160, (height - keyboard - bottomInset) * 0.6);
  const tone = milestoneTone(milestone.status);

  return (
    <View style={[styles.sheet, { bottom: bottomInset + keyboard, maxHeight }]} testID="milestone-sheet" accessibilityViewIsModal>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title} numberOfLines={2}>
            {milestone.title}
          </Text>
          <Text style={[styles.status, { color: toneInk(tone) }]}>{t(lang, milestoneStatusKey(milestone.status))}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t(lang, 'plan.close')} onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]} testID="milestone-sheet-close">
          <Text style={styles.closeInk}>×</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text style={styles.eyebrow}>{t(lang, 'plan.nodeSheet')}</Text>
        {milestone.goal ? (
          <View style={styles.section}>
            <Text style={styles.label}>{t(lang, 'plan.goal')}</Text>
            <Text style={styles.text}>{milestone.goal}</Text>
          </View>
        ) : null}
        {milestone.criteria.length ? (
          <View style={styles.section}>
            <Text style={styles.label}>{t(lang, 'plan.criteria')}</Text>
            {milestone.criteria.map((c) => (
              <Text key={c} style={styles.text}>
                ◦ {c}
              </Text>
            ))}
          </View>
        ) : null}
        {milestone.tasks.length ? (
          <View style={styles.section}>
            <Text style={styles.label}>{t(lang, 'plan.tasks')}</Text>
            {milestone.tasks.map((task) => (
              <View key={task.ref} style={styles.task}>
                <Text style={styles.taskTitle} numberOfLines={2}>
                  {task.title}
                </Text>
                <Text style={styles.taskStatus}>{t(lang, milestoneStatusKey(task.status === 'doing' ? 'working' : task.status === 'done' ? 'passed' : task.status))}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function toneInk(tone: ReturnType<typeof milestoneTone>): string {
  switch (tone) {
    case 'butter':
      return color.warn;
    case 'rose':
      return color.error;
    case 'mint':
      return color.ok;
    case 'sky':
    case 'lavender':
    case 'peach':
    case 'plain':
      return color.text2;
    default:
      return color.text2;
  }
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: space[3],
    right: space[3],
    backgroundColor: color.card,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    paddingLeft: space[5],
    paddingTop: space[4],
    paddingBottom: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  title: { ...type.heading, color: color.text },
  status: { ...type.caption, fontWeight: '600' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginTop: -6 },
  pressed: { backgroundColor: color.press },
  closeInk: { ...type.title, color: color.text2, lineHeight: 30 },
  scroll: { flexGrow: 0 },
  body: { padding: space[5], gap: space[4] },
  eyebrow: { ...type.eyebrow, color: color.text3 },
  section: { gap: space[2] },
  label: { ...type.caption, color: color.text2, fontWeight: '600' },
  text: { ...type.callout, color: color.text },
  task: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingVertical: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
  taskTitle: { ...type.callout, color: color.text, flex: 1 },
  taskStatus: { ...type.caption, color: color.text3 },
});
