import { router } from 'expo-router';
import { ChevronRight, MessagesSquare } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { MilestoneMap as SharedMilestoneMap, PlanUiThemeProvider, type MapItem } from '../../ui-plan';
import { elapsed, useSince, useView } from '../lib/hooks';
import type { ConvView, PlanView, Topic } from '../lib/link/protocol';
import { color } from '../lib/theme';
import { convHref, Prose, StepTicker } from './Conv';
import { Breathe, TypingDots } from './Live';
import { planUiTheme } from './PlanUiTheme';
import { Card, IconBadge, Press, T, toneOf } from './ui';

type Milestone = PlanView['milestones'][number];

/**
 * The plan's own conversation, on its page (the Mac keeps it beside the plan): what its Claude is
 * doing now (writing the plan, running it) or the last thing it said, and a tap into the whole chat.
 */
export function PlanChat({ topic, drafting }: { readonly topic: Topic; readonly drafting: boolean }) {
  const conv = useView<ConvView>(topic)?.data;
  const turns = conv?.turns ?? [];
  const live = [...turns].reverse().find((t) => t.who === 'claude' && t.status === 'working');
  const last = [...turns].reverse().find((t) => t.who === 'claude' && t.prose.text);
  const since = useSince(live?.ts);
  const working = Boolean(conv?.working);
  const title = drafting ? 'Writing the plan' : working ? 'Working on the plan' : 'The plan’s chat';
  return (
    <Press scaleTo={0.985} onPress={() => router.push(convHref(topic))} accessibilityLabel="Open the plan’s chat">
      <Card style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconBadge Icon={MessagesSquare} tone="lavender" size={30} />
          <View style={{ flex: 1 }}>
            <T v="callout" c={color.text} style={{ fontWeight: '700' }}>
              {title}
            </T>
            <T v="caption" numberOfLines={1}>
              {working ? `Your agent is at it${since !== undefined ? ` · ${elapsed(since)}` : ''}` : turns.length ? 'Tap for the whole conversation' : 'Tell your agent what to plan'}
            </T>
          </View>
          {working ? <TypingDots tone="lavender" /> : <ChevronRight color={color.text3} size={17} />}
        </View>
        {live?.step ? <StepTicker step={live.step} tone="lavender" /> : null}
        {last ? (
          <View style={{ maxHeight: 132, overflow: 'hidden' }}>
            <Prose prose={last.prose} size={14} color={color.text2} />
          </View>
        ) : null}
      </Card>
    </Press>
  );
}

/** While Claude writes the first plan: three soft milestone outlines and the one line that says so. */
export function PlanDrafting({ working }: { readonly working: boolean }) {
  return (
    <Animated.View entering={FadeIn.duration(260)} style={{ gap: 12 }}>
      <Breathe on={working}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[3, 2, 2].map((n, i) => (
            <View key={i} style={{ flex: 1, gap: 6, padding: 10, borderRadius: 14, backgroundColor: color.sunken }}>
              <View style={{ height: 10, width: '70%', borderRadius: 5, backgroundColor: color.hairlineStrong }} />
              {Array.from({ length: n }, (_, j) => (
                <View key={j} style={{ height: 22, borderRadius: 8, backgroundColor: color.card }} />
              ))}
            </View>
          ))}
        </View>
      </Breathe>
      <T v="caption" c={color.text2} style={{ textAlign: 'center' }}>
        {working ? 'Your agent is reading the code and writing the plan. Its milestones show here as they come.' : 'Your agent isn’t writing the plan right now. Tell it what to plan in the chat.'}
      </T>
    </Animated.View>
  );
}

/**
 * The plan as a small graph, drawn by the shared package: milestones in columns by what they wait
 * on, each with its state and progress. The companion keeps its own press (with haptics) and its
 * fade-in through `wrapNode`; the state words and tones are the companion's own.
 */
export function MilestoneMap({ milestones, onPick }: { readonly milestones: readonly Milestone[]; readonly onPick: (id: string) => void }) {
  const items: MapItem[] = milestones.map((m, i) => {
    const done = m.tasks.filter((t) => t.state === 'done').length;
    return {
      id: m.id,
      title: m.title,
      index: i + 1,
      tone: toneOf(m.state),
      statusLabel: m.state === 'gate' ? 'for you' : m.state,
      done,
      total: m.tasks.length,
      emphasized: m.state === 'running' || m.state === 'gate',
      passed: m.state === 'done',
      ...(m.dependsOn ? { dependsOn: m.dependsOn } : {}),
    };
  });
  return (
    <PlanUiThemeProvider theme={planUiTheme()}>
      <SharedMilestoneMap
        items={items}
        onPick={onPick}
        wrapNode={(node, item) => {
          const m = milestones[item.index - 1]!;
          return (
            <Animated.View entering={FadeIn.duration(180)}>
              <Press scaleTo={0.97} onPress={() => onPick(m.id)} accessibilityLabel={`${m.title}, ${m.state}, ${item.done} of ${item.total} tasks`}>
                {node}
              </Press>
            </Animated.View>
          );
        }}
      />
    </PlanUiThemeProvider>
  );
}
