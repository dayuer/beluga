import { Check, ChevronRight, User } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { planText } from './text';
import { usePlanUiTheme } from './theme';
import type { OutlineMilestone, OutlineTask } from './types';

export interface OutlineProps {
  readonly milestones: readonly OutlineMilestone[];
  /** The milestones open right now (the caller decides whether one or several may be open). */
  readonly open: readonly string[];
  readonly onToggle: (id: string) => void;
  readonly expandedTask?: string;
  readonly onTaskPress?: (task: OutlineTask) => void;
  readonly renderHeaderExtra?: (m: OutlineMilestone) => ReactNode;
  readonly renderExtra?: (m: OutlineMilestone) => ReactNode;
  readonly taskTrailing?: (t: OutlineTask) => ReactNode;
  readonly wrapRow?: (node: ReactNode, m: OutlineMilestone) => ReactNode;
  readonly wrapExpanded?: (node: ReactNode, m: OutlineMilestone) => ReactNode;
  readonly testID?: string;
}

/** The plan's timeline: number, title, progress, status, criteria and task rows, each milestone open or closed. */
export function Outline({ milestones, open, onToggle, expandedTask, onTaskPress, renderHeaderExtra, renderExtra, taskTrailing, wrapRow, wrapExpanded, testID }: OutlineProps) {
  return (
    <View testID={testID}>
      {milestones.map((m, i) => (
        <OutlineMilestoneRow
          key={m.id}
          m={m}
          last={i === milestones.length - 1}
          open={open.includes(m.id)}
          onToggle={() => onToggle(m.id)}
          expandedTask={expandedTask}
          onTaskPress={onTaskPress}
          renderHeaderExtra={renderHeaderExtra}
          renderExtra={renderExtra}
          taskTrailing={taskTrailing}
          wrapRow={wrapRow}
          wrapExpanded={wrapExpanded}
        />
      ))}
    </View>
  );
}

export interface OutlineMilestoneRowProps {
  readonly m: OutlineMilestone;
  readonly last?: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly expandedTask?: string;
  readonly onTaskPress?: (task: OutlineTask) => void;
  readonly renderHeaderExtra?: (m: OutlineMilestone) => ReactNode;
  readonly renderExtra?: (m: OutlineMilestone) => ReactNode;
  readonly taskTrailing?: (t: OutlineTask) => ReactNode;
  readonly wrapRow?: (node: ReactNode, m: OutlineMilestone) => ReactNode;
  readonly wrapExpanded?: (node: ReactNode, m: OutlineMilestone) => ReactNode;
}

/** One milestone of the timeline. The caller controls whether it is open. */
export function OutlineMilestoneRow({ m, last = false, open, onToggle, expandedTask, onTaskPress, renderHeaderExtra, renderExtra, taskTrailing, wrapRow, wrapExpanded }: OutlineMilestoneRowProps) {
  const theme = usePlanUiTheme();
  const passed = Boolean(m.passed);

  const row = (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <View style={{ width: 26, alignItems: 'center' }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.toneBg(m.tone) }}>
          {passed ? (
            <Check color={theme.toneInk(m.tone)} size={15} strokeWidth={2.2} />
          ) : (
            <Text style={{ ...planText.caption, fontWeight: '800', color: theme.toneInk(m.tone) }}>{m.index}</Text>
          )}
        </View>
        {!last ? (
          <View
            style={{
              width: 2,
              flex: 1,
              marginVertical: 4,
              borderRadius: 1,
              backgroundColor: passed ? theme.toneBg('mint') : theme.color.hairlineStrong,
            }}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 18 }}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${m.title}, ${m.statusLabel}, ${m.done} of ${m.total}`}
          style={({ pressed }) => [{ opacity: pressed ? 0.55 : 1 }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 26 }}>
            <Text style={{ ...planText.heading, flex: 1, color: passed ? theme.color.text2 : theme.color.text }} numberOfLines={2}>
              {m.title}
            </Text>
            <Text style={{ ...planText.caption, color: theme.color.text3 }}>
              {m.done}/{m.total}
            </Text>
          </View>
          <Text style={{ ...planText.caption, fontWeight: '600', marginTop: 2, textTransform: 'capitalize', color: theme.toneInk(m.tone) }}>{m.statusLabel}</Text>
          {renderHeaderExtra?.(m)}
          {m.after?.length ? (
            <Text style={{ ...planText.caption, color: theme.color.text3, marginTop: 2 }} numberOfLines={2}>
              After {m.after.join(', ')}
            </Text>
          ) : m.dependsOn && m.index > 1 ? (
            <Text style={{ ...planText.caption, color: theme.color.text3, marginTop: 2 }}>Runs alongside the others</Text>
          ) : null}
        </Pressable>
        {open ? renderExpanded() : null}
      </View>
    </View>
  );

  function renderExpanded(): ReactNode {
    const expanded = (
      <View style={{ marginTop: 10, gap: 8 }}>
        {m.criteria.length ? (
          <View style={{ gap: 3, marginBottom: 2 }}>
            {m.criteria.map((c) => (
              <Text key={c} style={{ ...planText.caption, color: theme.color.text2 }}>
                ◦ {c}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={[styles.card, { backgroundColor: theme.color.card, borderColor: theme.color.hairline }, theme.cardStyle]}>
          {m.tasks.map((t, ti) => (
            <OutlineTaskRow
              key={t.id}
              t={t}
              first={ti === 0}
              expanded={expandedTask === t.id}
              onPress={onTaskPress}
              trailing={taskTrailing}
            />
          ))}
        </View>
        {renderExtra?.(m)}
      </View>
    );
    return wrapExpanded ? wrapExpanded(expanded, m) : expanded;
  }

  return wrapRow ? wrapRow(row, m) : row;
}

function OutlineTaskRow({
  t,
  first,
  expanded,
  onPress,
  trailing,
}: {
  readonly t: OutlineTask;
  readonly first: boolean;
  readonly expanded: boolean;
  readonly onPress?: (task: OutlineTask) => void;
  readonly trailing?: (t: OutlineTask) => ReactNode;
}) {
  const theme = usePlanUiTheme();
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 11,
        paddingHorizontal: 12,
        borderTopWidth: first ? 0 : 0.5,
        borderTopColor: theme.color.hairline,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.tone === 'plain' ? theme.color.hairlineStrong : theme.toneInk(t.tone) }} />
      <View style={{ flex: 1 }}>
        <Text
          style={{ ...planText.callout, color: t.tone === 'mint' ? theme.color.text2 : theme.color.text }}
          numberOfLines={expanded ? undefined : 2}
        >
          {t.title}
        </Text>
        {t.sub ? (
          <Text style={{ ...planText.caption, color: theme.color.text3 }} numberOfLines={expanded ? undefined : 1}>
            {t.sub}
          </Text>
        ) : null}
        {expanded && t.goal ? (
          <Text style={{ ...planText.caption, color: theme.color.text2, marginTop: 4 }}>{t.goal}</Text>
        ) : null}
        {expanded && t.acceptance?.length ? (
          <View style={{ marginTop: 4, gap: 2 }}>
            {t.acceptance.map((a) => (
              <Text key={a} style={{ ...planText.caption, color: theme.color.text2 }}>
                ◦ {a}
              </Text>
            ))}
          </View>
        ) : null}
        {expanded && t.note ? (
          <Text style={{ ...planText.caption, color: theme.color.text3, marginTop: 4 }}>{t.note}</Text>
        ) : null}
      </View>
      {t.mine ? <User color={theme.color.info} size={13} /> : null}
      <Text style={{ ...planText.caption, fontWeight: '600', color: theme.toneInk(t.tone) }}>{t.statusLabel}</Text>
      {t.opens ? <ChevronRight color={theme.color.text3} size={15} /> : null}
      {trailing?.(t)}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={() => onPress(t)} accessibilityRole="button" style={({ pressed }) => [{ opacity: pressed ? 0.55 : 1 }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
  },
});
