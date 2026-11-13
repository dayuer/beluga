import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronDown, ChevronRight, Eye, Gauge, Hand, Monitor, Rocket } from 'lucide-react-native';
import { Options } from '../../components/Options';
import { AgentMarkIcon, markIcon, runtimeMark } from '../../components/AgentMark';
import { AgentChoiceSheet, agentOfRow } from '../../components/AgentPicker';
import { agentName } from '../../../../src/shared/agent-label';
import { openOnMac } from '../../lib/mac';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { LinearTransition, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { convHref } from '../../components/Conv';
import { answer, NeedButtons, NeedFace } from '../../components/Needs';
import { MilestoneMap, PlanChat, PlanDrafting } from '../../components/PlanParts';
import { planUiTheme } from '../../components/PlanUiTheme';
import { OutlineMilestoneRow, PlanUiThemeProvider, type OutlineMilestone } from '../../../ui-plan';
import { Header, Screen, useScrolled } from '../../components/Screen';
import { Card, More, Pill, Press, T, haptic, toneBg, toneInk, toneOf } from '../../components/ui';
import { useView, useVisibleNeeds } from '../../lib/hooks';
import type { ConvView, PlanView, Topic } from '../../lib/link/protocol';
import { color } from '../../lib/theme';
import { calls } from '../../lib/link/calls';
import { store } from '../../lib/store';
import { MilestoneRoles } from '../../components/fork/MilestoneRoles';

/** How a plan runs (src/core/plans/model.ts AUTONOMY_INFO), as the Mac says it. */
const AUTONOMY = {
  step: { label: 'Step by Step', sub: 'You start each task', Icon: Hand },
  gated: { label: 'Check-ins', sub: 'Runs, then waits for you at each milestone', Icon: Gauge },
  autopilot: { label: 'Autopilot', sub: 'Runs to the end, stops only if something fails', Icon: Rocket },
} as const;
type Autonomy = keyof typeof AUTONOMY;

/**
 * A plan (Advanced Planning) as it's designed and run: its goal, decisions waiting on you (Approve
 * or Discard a draft, pass a milestone), how it runs (Step by Step, Check-ins, Autopilot), and the
 * milestones as a vertical timeline: their criteria, what each waits on, their tasks with what
 * they wait on and what done means, and which run side by side now. The plan's shape is edited on
 * the Mac (or by asking its Claude in its conversation).
 */
export default function Plan() {
  const { scrolled, onScroll } = useScrolled();
  const { id } = useLocalSearchParams<{ id: string }>();
  const topic = `plan:${id}` as Topic;
  const view = useView<PlanView>(topic);
  const p = view?.data;
  const needs = useVisibleNeeds(p?.needsYou);
  const insets = useSafeAreaInsets();
  const tasks = p?.milestones.flatMap((m) => m.tasks) ?? [];
  const done = tasks.filter((t) => t.state === 'done').length;
  const [menu, setMenu] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickingCheck, setPickingCheck] = useState(false);
  const [pickingArch, setPickingArch] = useState(false);
  const [pickingFix, setPickingFix] = useState(false);
  // Who works its milestones and tasks (1.35, BLG-498): its own pick, else your default; changed from ⋯.
  const defaultGroup = p?.agents?.groups.find((g) => g.isDefault);
  const agentWords = p?.agent ? agentName(p.agent, { model: true }) : defaultGroup ? `Your agent (${defaultGroup.label})` : 'Your agent';
  const agentRuntime = p?.agent?.runtime ?? defaultGroup?.runtime;
  const setAgent = (agent: { runtime: string; label: string; model?: string } | null, label: string): void => {
    void store.call<string>(calls.setPlanAgent(id ?? '', agent, label)).then(
      (said) => store.toast({ text: typeof said === 'string' ? said : `${label} works this plan`, tone: 'ok' }),
      (e: Error) => store.toast({ text: e.message, tone: 'error' }),
    );
  };
  // Who checks its milestones and reviews its drafts (1.50): its own pick, else the agent for its work.
  const checkWords = p?.checkAgent ? agentName(p.checkAgent, { model: true }) : 'Same as its work';
  const setCheckAgent = (agent: { runtime: string; label: string; model?: string } | null, label: string): void => {
    void store.call<string>(calls.setPlanCheckAgent(id ?? '', agent, label)).then(
      (said) => store.toast({ text: typeof said === 'string' ? said : `${label} checks this plan`, tone: 'ok' }),
      (e: Error) => store.toast({ text: e.message, tone: 'error' }),
    );
  };
  // Who designs each milestone before its work starts (1.57): none, the milestones start right away.
  const archWords = p?.archAgent ? agentName(p.archAgent, { model: true }) : 'No architect';
  const setArchAgent = (agent: { runtime: string; label: string; model?: string } | null, label: string): void => {
    void store.call<string>(calls.setPlanArchAgent(id ?? '', agent, label)).then(
      (said) => store.toast({ text: typeof said === 'string' ? said : `${label} designs this plan's milestones`, tone: 'ok' }),
      (e: Error) => store.toast({ text: e.message, tone: 'error' }),
    );
  };
  // Who takes over what's hard (1.58): fix tasks after a failed check, conflicts, a task that stopped twice. None: auto route's strongest.
  const fixWords = p?.fixAgent ? agentName(p.fixAgent, { model: true }) : 'Strongest model';
  const setFixAgent = (agent: { runtime: string; label: string; model?: string } | null, label: string): void => {
    void store.call<string>(calls.setPlanFixAgent(id ?? '', agent, label)).then(
      (said) => store.toast({ text: typeof said === 'string' ? said : `${label} takes over what's hard`, tone: 'ok' }),
      (e: Error) => store.toast({ text: e.message, tone: 'error' }),
    );
  };
  const how = p?.autonomy && p.autonomy in AUTONOMY ? AUTONOMY[p.autonomy as Autonomy] : undefined;
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const milestoneTitles = new Map((p?.milestones ?? []).map((m) => [m.id, m.title]));
  const blocked = tasks.filter((t) => t.state === 'blocked').length;
  // Claude is still writing the first plan: its chat and one placeholder, nothing to run or approve yet.
  const drafting = p?.state === 'draft' && !p.milestones.length;
  const writing = Boolean(useView<ConvView>(drafting ? p?.topic : undefined)?.data.working);
  // The map's tap: scroll the timeline to that milestone and open it.
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tops = useRef(new Map<string, number>());
  const listTop = useRef(0);
  const [picked, setPicked] = useState<{ id: string; n: number } | undefined>();
  const pick = (mid: string) => {
    setPicked((was) => ({ id: mid, n: (was?.n ?? 0) + 1 }));
    const y = tops.current.get(mid);
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, listTop.current + y - 80), animated: true });
  };

  return (
    <Screen>
      <Header scrolled={scrolled} back eyebrow="Plan" title={p?.title ?? 'Plan'} at={view?.at} right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {p ? <Pill label={p.state === 'running' ? 'Running' : p.state} tone={toneOf(p.state)} /> : null}
            <More onPress={() => setMenu(true)} label="Plan options" />
          </View>
        } />
      <Options
        visible={menu}
        onClose={() => setMenu(false)}
        title={p?.title}
        options={[
          { Icon: markIcon(runtimeMark(agentRuntime)), label: 'Agent for its work', sub: agentWords, tone: 'lavender', hidden: !p?.agents, onPress: () => setPicking(true) },
          { Icon: markIcon(runtimeMark(p?.checkAgent?.runtime ?? agentRuntime)), label: 'Agent for its checks', sub: checkWords, tone: 'lavender', hidden: !p?.agents || !store.supports('checkAgent'), onPress: () => setPickingCheck(true) },
          { Icon: markIcon(runtimeMark(p?.archAgent?.runtime ?? agentRuntime)), label: 'Agent for its architecture', sub: archWords, tone: 'lavender', hidden: !p?.agents || !store.supports('archAgent'), onPress: () => setPickingArch(true) },
          { Icon: markIcon(runtimeMark(p?.fixAgent?.runtime ?? agentRuntime)), label: 'Agent for hard fixes', sub: fixWords, tone: 'lavender', hidden: !p?.agents || !store.supports('fixAgent'), onPress: () => setPickingFix(true) },
          { Icon: Monitor, label: 'Open on your Mac', sub: 'Its graph, outline and conversation', tone: 'plain', onPress: () => void openOnMac({ topic }) },
        ]}
      />
      <AgentChoiceSheet
        title="Agent for its work"
        caption={p?.running ? 'For what starts next: milestones at work keep their agent' : 'Works its milestones and tasks'}
        picker={p?.agents}
        visible={picking}
        onClose={() => setPicking(false)}
        yours={{ on: !p?.agent, onPick: () => setAgent(null, 'Your agent') }}
        onPick={(g, value, label) => setAgent(agentOfRow(g, value), value ? `${g.label} · ${label}` : g.label)}
      />
      <AgentChoiceSheet
        title="Agent for its checks"
        caption="Checks its milestones and reviews its drafts: a stronger model than the work's, say"
        picker={p?.agents}
        visible={pickingCheck}
        onClose={() => setPickingCheck(false)}
        yours={{ on: !p?.checkAgent, onPick: () => setCheckAgent(null, 'Same as its work'), label: 'Same as its work', caption: `Whoever works it checks it too (${agentWords})` }}
        onPick={(g, value, label) => setCheckAgent(agentOfRow(g, value), value ? `${g.label} · ${label}` : g.label)}
      />
      <AgentChoiceSheet
        title="Agent for its architecture"
        caption="Writes each milestone's design before its work starts: its agent follows it, its checker checks against it"
        picker={p?.agents}
        visible={pickingArch}
        onClose={() => setPickingArch(false)}
        yours={{ on: !p?.archAgent, onPick: () => setArchAgent(null, 'No architect'), label: 'No architect', caption: 'Each milestone starts right away, without a design' }}
        onPick={(g, value, label) => setArchAgent(agentOfRow(g, value), value ? `${g.label} · ${label}` : g.label)}
      />
      <AgentChoiceSheet
        title="Agent for hard fixes"
        caption="Takes over fix tasks after a failed check, conflicts, and a task that stopped twice"
        picker={p?.agents}
        visible={pickingFix}
        onClose={() => setPickingFix(false)}
        yours={{ on: !p?.fixAgent, onPick: () => setFixAgent(null, 'Strongest model'), label: 'Strongest model', caption: 'Auto route’s strongest model; with auto route off, whoever is at it keeps it' }}
        onPick={(g, value, label) => setFixAgent(agentOfRow(g, value), value ? `${g.label} · ${label}` : g.label)}
      />
      <Options
        visible={howOpen}
        onClose={() => setHowOpen(false)}
        title="How it runs"
        options={(Object.keys(AUTONOMY) as Autonomy[]).map((a) => ({
          Icon: AUTONOMY[a].Icon,
          label: AUTONOMY[a].label,
          sub: AUTONOMY[a].sub,
          tone: a === p?.autonomy ? ('lavender' as const) : ('plain' as const),
          onPress: () => void store.call(calls.setAutonomy(id ?? '', a, AUTONOMY[a].label)).catch((e: Error) => store.toast({ text: e.message, tone: 'error' })),
        }))}
      />
      <ScrollView ref={scroll} onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {p ? (
          <>
            <View style={{ paddingHorizontal: 20, paddingTop: 6, gap: 12 }}>
              {p.goal ? <T v="callout" style={{ fontSize: 15, lineHeight: 21 }}>{p.goal}</T> : null}
              {drafting ? null : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: color.sunken, overflow: 'hidden' }}>
                  <View style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%`, height: 6, borderRadius: 3, backgroundColor: color.ok, opacity: 0.5 }} />
                </View>
                <T v="caption" c={color.text2}>
                  {done} of {tasks.length} tasks
                </T>
              </View>}
              {p.running || blocked ? (
                <T v="caption" c={color.text2}>
                  {[p.running ? `${p.running} running side by side${p.parallel ? ` (up to ${p.parallel})` : ''}` : '', blocked ? `${blocked} waiting on others` : ''].filter(Boolean).join(' · ')}
                </T>
              ) : null}
              {how && !drafting ? (
                <Press onPress={() => setHowOpen(true)} accessibilityLabel={`How it runs: ${how.label}`} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: toneBg('lavender') }}>
                  <how.Icon color={toneInk('lavender')} size={15} strokeWidth={1.9} />
                  <T v="caption" c={toneInk('lavender')} style={{ fontWeight: '700' }}>
                    {how.label}
                    {p.paused ? ' · paused' : ''}
                  </T>
                  <ChevronDown color={toneInk('lavender')} size={14} />
                </Press>
              ) : null}
              {p.agent || p.agents ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <AgentMarkIcon mark={runtimeMark(agentRuntime)} size={14} color={color.text2} />
                  <T v="caption" c={color.text2}>
                    Worked by {agentWords}
                  </T>
                </View>
              ) : null}
              {/* A fresh agent reads the draft before you approve it (1.45, BLG-772); what it finds waits on you below. */}
              {p.review?.state === 'reviewing' ? <Verifying review={p.review} /> : null}
              {p.topic ? <PlanChat topic={p.topic} drafting={drafting} /> : null}
            </View>

            {/* The plan as a small graph, first thing under its chat: what runs after what, at a glance. */}
            {!drafting && p.milestones.length > 1 ? (
              <View style={{ marginTop: 24, gap: 12 }}>
                <T v="eyebrow" style={{ paddingHorizontal: 20 }}>
                  Map
                </T>
                <MilestoneMap milestones={p.milestones} onPick={pick} />
              </View>
            ) : null}
            {needs.length ? (
              <View style={{ marginTop: 20, gap: 10 }}>
                <T v="eyebrow" style={{ paddingHorizontal: 20 }}>
                  Waiting on you
                </T>
                {needs.map((n) => (
                  <Animated.View key={n.id} entering={FadeIn.duration(180)} layout={LinearTransition.duration(180)}>
                    <Card style={{ marginHorizontal: 16, padding: 16, gap: 14 }}>
                      <NeedFace item={n} more />
                      <NeedButtons item={n} onAnswer={(t) => answer(n, t)} />
                    </Card>
                  </Animated.View>
                ))}
              </View>
            ) : null}

            {/* What the plan has decided (1.47): a replaced decision stays, crossed out. */}
            {p.decisions?.length ? (
              <View style={{ marginTop: 22, paddingHorizontal: 20, gap: 8 }}>
                <T v="eyebrow">Decisions</T>
                {p.decisions.map((d, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                    <Check color={d.replaced ? color.text3 : color.ok} size={14} strokeWidth={2} style={{ marginTop: 3 }} />
                    <T v="callout" c={d.replaced ? color.text3 : color.text} style={{ flex: 1, ...(d.replaced ? { textDecorationLine: 'line-through' as const } : {}) }}>
                      {d.text}
                    </T>
                  </View>
                ))}
              </View>
            ) : null}

            {drafting ? (
              <View style={{ marginTop: 26, paddingHorizontal: 16 }}>
                <PlanDrafting working={writing} />
              </View>
            ) : (
              <>
                <View style={{ marginTop: 26, paddingHorizontal: 16 }} onLayout={(e) => (listTop.current = e.nativeEvent.layout.y)}>
                  <T v="eyebrow" style={{ paddingHorizontal: 4, marginBottom: 14 }}>
                    Milestones
                  </T>
                  {p.milestones.map((m, i) => (
                    <View key={m.id} onLayout={(e) => tops.current.set(m.id, e.nativeEvent.layout.y)}>
                      <Milestone m={m} last={i === p.milestones.length - 1} i={i} draft={p.state === 'draft'} titles={titles} after={(m.dependsOn ?? []).map((d) => milestoneTitles.get(d) ?? d)} picked={picked?.id === m.id ? picked.n : 0} />
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        ) : (
          <T v="callout" style={{ padding: 20 }}>
            Opening the plan…
          </T>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * A fresh agent verifying the plan (1.45, BLG-772): a breathing dot, how many of its four checks are
 * behind it, and its latest line (each new one fading in), so it never looks stuck.
 */
function Verifying({ review }: { review: NonNullable<PlanView['review']> }) {
  const breath = useSharedValue(0.35);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!reduced) breath.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [breath, reduced]);
  const dot = useAnimatedStyle(() => ({ opacity: breath.value }));
  const done = review.checksDone ?? 0;
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: 14, backgroundColor: toneBg('lavender') }} accessibilityRole="summary" accessibilityLabel={`Verifying the plan: ${done} of 4 checks done`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: toneInk('lavender') }, dot]} />
        <T v="caption" c={toneInk('lavender')} style={{ fontWeight: '700', flex: 1 }}>
          Verifying the plan
        </T>
        <T v="caption" c={toneInk('lavender')}>
          {done} of 4 checks
        </T>
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: toneInk('lavender'), opacity: i < done ? 0.8 : i === done ? 0.4 : 0.15 }} />
        ))}
      </View>
      {review.now ? (
        <Animated.View key={review.now} entering={FadeIn.duration(220)}>
          <T v="caption" c={color.text2} numberOfLines={2}>
            {review.now}
          </T>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Milestone({ m, last, i, draft, titles, after, picked }: { m: PlanView['milestones'][number]; last: boolean; i: number; draft: boolean; titles: ReadonlyMap<string, string>; after: readonly string[]; picked: number }) {
  // A draft reads whole (you approve it from here); a running plan opens where the work is.
  const [open, setOpen] = useState(draft || m.state === 'running' || m.state === 'waiting' || m.state === 'gate');
  // Tapped on the map: open (each tap, though you closed it since).
  useEffect(() => {
    if (picked) setOpen(true);
  }, [picked]);
  const [task, setTask] = useState<string | undefined>();
  // Its design from the plan's architect (1.57), folded until tapped.
  const [designOpen, setDesignOpen] = useState(false);
  const n = m.tasks.filter((t) => t.state === 'done').length;
  const agentNow = m.agentNow;
  const checker = m.checker;
  const outline: OutlineMilestone = {
    id: m.id,
    title: m.title,
    index: i + 1,
    tone: toneOf(m.state),
    statusLabel: m.designing ? 'The architect is designing it' : m.state === 'gate' ? 'Waiting for you to pass it' : m.state,
    done: n,
    total: m.tasks.length,
    passed: m.state === 'done',
    criteria: m.criteria,
    tasks: m.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      tone: toneOf(t.state),
      statusLabel: t.state,
      ...(t.goal ? { goal: t.goal } : {}),
      ...(t.acceptance?.length ? { acceptance: t.acceptance } : {}),
      ...(t.blockedBy?.length ? { sub: `Waits on ${t.blockedBy.map((b) => titles.get(b) ?? b).join(', ')}` } : {}),
      ...(t.why ? { note: t.why } : {}),
      ...(t.mine ? { mine: true } : {}),
      ...(t.topic ? { opens: true } : {}),
    })),
    ...(after.length ? { after } : {}),
    ...(m.dependsOn ? { dependsOn: m.dependsOn } : {}),
  };
  return (
    <PlanUiThemeProvider theme={planUiTheme()}>
      <OutlineMilestoneRow
        m={outline}
        last={last}
        open={open}
        onToggle={() => {
          haptic.tap();
          setOpen((o) => !o);
        }}
        expandedTask={task}
        onTaskPress={(t) => {
          haptic.tap();
          const raw = m.tasks.find((x) => x.id === t.id);
          if (!raw) return;
          // Its worktree's conversation once it has one; until then a tap shows what it's for.
          if (raw.topic) router.push(convHref(raw.topic));
          else setTask((shown) => (shown === raw.id ? undefined : raw.id));
        }}
        renderHeaderExtra={() =>
          agentNow ? (
            // Its agent at work right now, even between tasks (1.40): a tap opens its conversation.
            <Press scaleTo={0.98} onPress={() => (agentNow.topic ? router.push(convHref(agentNow.topic)) : setOpen(true))}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: agentNow.asking ? color.warn : color.claude }} />
                <T v="caption" c={agentNow.asking ? color.warn : color.claude} numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
                  {agentNow.text}
                </T>
                {agentNow.topic ? <ChevronRight color={color.text3} size={13} /> : null}
              </View>
            </Press>
          ) : null
        }
        renderExtra={() => (
          <>
            {m.design ? (
              <Press scaleTo={0.98} onPress={() => setDesignOpen((o) => !o)} accessibilityLabel={designOpen ? 'Hide its design' : 'Show its design'}>
                <View style={{ gap: 6, padding: 12, borderRadius: 14, backgroundColor: toneBg('lavender') }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {designOpen ? <ChevronDown color={toneInk('lavender')} size={15} /> : <ChevronRight color={toneInk('lavender')} size={15} />}
                    <T v="caption" c={toneInk('lavender')} style={{ fontWeight: '700', flex: 1 }}>
                      Design
                    </T>
                    <T v="caption" c={color.text3}>
                      From its architect
                    </T>
                  </View>
                  {designOpen ? (
                    <Animated.View entering={FadeIn.duration(180)}>
                      <T v="caption" c={color.text2}>
                        {m.design}
                      </T>
                    </Animated.View>
                  ) : null}
                </View>
              </Press>
            ) : null}
            <MilestoneRoles {...(m.roles ? { roles: m.roles } : {})} />
            {checker ? (
            // Its checker (a Claude of its own, off the Mac's sidebar): watched live, or read once it said (1.39).
            <Press scaleTo={0.98} onPress={() => router.push(convHref(checker))}>
              <Card r={16}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12 }}>
                  <Eye color={toneInk('lavender')} size={15} />
                  <T v="callout" style={{ flex: 1 }}>
                    {m.state === 'checking' ? 'Watch the check' : 'Open the check'}
                  </T>
                  <ChevronRight color={color.text3} size={15} />
                </View>
              </Card>
            </Press>
            ) : null}
          </>
        )}
        wrapRow={(node) => <Animated.View entering={FadeIn.duration(180)}>{node}</Animated.View>}
        wrapExpanded={(node) => <Animated.View entering={FadeIn.duration(180)}>{node}</Animated.View>}
      />
    </PlanUiThemeProvider>
  );
}
