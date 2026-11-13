import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { waitingKey, stageKey, type PlanRowData } from '../lib/plan-rows';
import { detectLang, t } from '../lib/strings';
import { color, radius, space, stroke, type } from '../lib/theme';
import { ProgressRing } from './ProgressRing';

/** A plan on the project page: ring, title, who it is waiting on, progress. The whole row opens
 * the plan page (M6 §1). */
export function PlanRow({ plan, pid }: { readonly plan: PlanRowData; readonly pid: string }) {
  const router = useRouter();
  const lang = detectLang();
  const waiting = plan.waitingOn === 'customer';
  const tone = waiting ? 'warn' : plan.waitingOn === 'ai' ? 'ok' : 'text';
  const status = t(lang, waitingKey(plan.waitingOn));
  const detail = plan.headline.trim() || t(lang, stageKey(plan.stage));

  return (
    <Pressable
      onPress={() => router.push(`/plan/${encodeURIComponent(plan.planRef)}?project=${encodeURIComponent(pid)}`)}
      accessibilityRole="button"
      accessibilityLabel={`${plan.title}, ${status}, ${detail}, ${plan.progress.done} / ${plan.progress.total}`}
      testID={`plan-row-${plan.planRef}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <ProgressRing done={plan.progress.done} total={plan.progress.total} tone={tone} />
      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={1}>
          {plan.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, waiting ? styles.waiting : plan.waitingOn === 'ai' ? styles.working : null]} numberOfLines={1}>
            {status}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {' · '}
            {detail}
          </Text>
        </View>
      </View>
      <Text style={styles.progress}>
        {plan.progress.done} / {plan.progress.total}
      </Text>
      <ChevronRight color={color.text3} size={17} strokeWidth={stroke} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: radius.l,
    paddingVertical: 14,
    paddingHorizontal: space[5],
    marginBottom: 10,
    shadowColor: color.shadowInk,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
  },
  pressed: { backgroundColor: color.press },
  main: { flex: 1, minWidth: 0 },
  title: { ...type.heading, color: color.text, fontSize: 15.5, lineHeight: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3, minWidth: 0 },
  meta: { ...type.caption, color: color.text2, flexShrink: 1 },
  waiting: { color: color.warn, fontWeight: '500' },
  working: { color: color.ok, fontWeight: '500' },
  progress: { ...type.caption, color: color.text3 },
});
