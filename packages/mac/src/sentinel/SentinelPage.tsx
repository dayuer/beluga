import { useRef, useState } from 'react';
import { ACCESS, ACCESS_INFO, type Access, CLAUDE_CHANGED, CLAUDE_CHANGED_BANNER, DEFAULT_KEEP_CHATS, KEEP_CHATS, KEEP_CHATS_INFO, type KeepChats, FIRST_SENTINEL_CHAT, sentinelChatChannel, NOTIFY_WHERE, type RunSummary, type Sentinel, type SentinelPatch, TIME_LIMITS, accessRank, runsOf, scheduleSentence } from '@beluga/core/sentinel/model.js';
import { activityOf } from '@beluga/ui/workspace-models.js';
import { recipeById } from '@beluga/core/sentinel/recipes.js';
import { Icon } from '../components/Icon.js';
import { Select } from '../components/Select.js';
import { useAgentEntries } from '../components/agent-options.js';
import { type ActionItem, ActionsDropdown } from '../components/SpecMenu.js';
import { Button, Empty, IconButton, Tip, cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { useActions } from '../lib/actions.js';
import { AskPanel, SentinelChat } from './SentinelChat.js';
import { Attention } from '../chat/Attention.js';
import home from './home.module.css';
import { useSwipeBack } from '../tasks/use-swipe-back.js';
import { SwipeBackEdge } from '../tasks/SwipeBackEdge.js';
import { ago } from '../tasks/tasks-model.js';
import { ClaudeMark, Disc, RunPill } from './marks.js';
import { StepsCard, WhenCard } from './SentinelCards.js';
import { DataCard } from './DataCard.js';
import { NumbersCard } from './NumbersCard.js';
import {
  MAC_SCOPE,
  NOTIFY_LABEL,
  PAUSE_AFTER_CHOICES,
  PER_DAY_CHOICES,
  accessSentence,
  askLine,
  byWords,
  chatPlaceOf,
  dotStrip,
  durationText,
  headlineOf,
  iconOf,
  pauseAfterLabel,
  perDayLabel,
  runDuration,
  sharedAgent,
  whenText,
  withAgent,
} from './sentinel-model.js';
import { useDraft } from './use-draft.js';
import { useClock } from '../lib/window-active.js';
import { useRunsFolder, useSentinelActions, useSentinelState } from './use-sentinel.js';
import t from '../tasks/tasks.module.css';
import s from './sentinel.module.css';
import { shortcutKeys } from '../lib/shortcuts.js';
import { primaryKey } from '../lib/shortcuts-model.js';
import { ASSISTANT_TITLE } from '@beluga/shared/assistant.js';
import { tl, useT } from '../i18n/index.js';

/**
 * A sentinel's page: the editor and its history in one. The name is renamed in place, When and
 * Steps change as you go (saved at once: no Save button), the properties run down the right, and
 * the history shows the last 30 runs as dots, then as rows that open the run. ⌘[ or Esc go back.
 */
export function SentinelPage({ id }: { id: string }) {
  const state = useSentinelState();
  const item = state.items.find((x) => x.id === id);
  const tr = useT();
  if (!state.enabled) return <Empty icon="sentinel" title={tr('sentinel.run.needsApp')} />;
  if (!item) return <Empty icon="sentinel" title={tr('sentinel.page.gone')} detail={tr('sentinel.page.goneDetail')} />;
  return <Page item={item} />;
}

function Page({ item }: { item: Sentinel }) {
  const wrap = useRef<HTMLDivElement>(null);
  const a = useSentinelActions();
  const back = (): void => a.openList();
  const swipe = useSwipeBack(wrap, back);
  const save = (patch: SentinelPatch): void => void a.act(() => a.update(item.id, patch));
  // The Sentinel chat docks beside the page when you ask from here (its properties make room for it).
  const asking = useApp((st) => st.view.kind === 'sentinel_chat' && st.view.about === item.id);
  return (
    <div className={home.home}>
      <div ref={wrap} className={cx(t.pageWrap, home.grow)}>
        <SwipeBackEdge progress={swipe} />
        <div className={t.page}>
          <div className={t.pageMain} data-sentinel-page={item.id}>
            <Crumbs item={item} back={back} />
            <Header item={item} save={save} />
            <AskBox item={item} />
            <Banners item={item} />
            <WhenCard item={item} save={save} />
            <StepsCard item={item} save={save} />
            <NumbersCard item={item} />
            <History item={item} />
            <DataCard item={item} />
          </div>
          {asking ? null : <Properties item={item} save={save} />}
        </div>
      </div>
      {asking ? (
        <AskPanel>
          <SentinelChat onClose={() => a.open(item.id)} />
        </AskPanel>
      ) : null}
    </div>
  );
}

function Crumbs({ item, back }: { item: Sentinel; back: () => void }) {
  const a = useSentinelActions();
  const project = useApp((st) => st.projects.find((p) => p.id === item.projectId));
  const tr = useT();
  return (
    <nav className={t.crumbs} aria-label={tr('sentinel.page.where')}>
      <IconButton icon="back" label={tr('sentinel.run.back')} keys={shortcutKeys('page-back')} className={t.crumbBack} onClick={back} />
      <button type="button" className={t.crumb} onClick={() => a.openList()}>
        {tr('sentinel.marks.sentinel')}
      </button>
      <Icon name="chevronRight" size={10} />
      <button type="button" className={t.crumb} onClick={() => a.openList(item.projectId ?? MAC_SCOPE)}>
        {project?.name ?? ASSISTANT_TITLE}
      </button>
      <span className={t.grow} />
    </nav>
  );
}

function Header({ item, save }: { item: Sentinel; save: (patch: SentinelPatch) => void }) {
  const a = useSentinelActions();
  const folder = useRunsFolder();
  const items = useApp((st) => st.sentinel.items);
  const tr = useT();
  const name = useDraft(item.name, (v) => {
    const next = v.replace(/\s+/g, ' ').trim();
    if (next && next !== item.name) save({ name: next });
  });
  const more: ActionItem[] = [
    { label: tr('sentinel.menu.duplicate'), icon: 'copy', onSelect: () => void a.duplicate(item) },
    { label: tr('sentinel.page.copyJson'), icon: 'copy', onSelect: () => a.copyJson(item) },
    ...(folder ? [{ label: tr('sentinel.home.runsFolder'), icon: 'folder' as const, onSelect: () => a.openFolder(folder) }] : []),
    { label: tr('sentinel.menu.delete'), danger: true, separate: true, onSelect: () => a.remove(item, () => a.openList()) },
  ];
  return (
    <header className={s.head}>
      <Disc icon={item.paused ? 'pause' : iconOf(item.icon)} tone={item.paused ? 'paused' : item.trigger.kind === 'schedule' ? 'clock' : item.trigger.kind === 'manual' || item.trigger.kind === 'after' ? 'hand' : 'event'} size={40} />
      <div className={s.headText}>
        <input
          className={s.name}
          value={name.text}
          aria-label={tr('sentinel.new.name')}
          spellCheck={false}
          onChange={(e) => name.change(e.target.value)}
          onBlur={name.flush}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <span className={s.subtitle}>{scheduleSentence(item.trigger, (id) => items.find((x) => x.id === id)?.name)}</span>
      </div>
      <div className={s.headActions}>
        <Tip label={item.paused ? tr('sentinel.page.runNowPaused') : tr('sentinel.page.runNowTip')}>
          <Button size="small" icon="play" variant={item.paused ? 'plain' : 'primary'} onClick={() => void a.runNow(item)}>
            {tr('sentinel.menu.runNow')}
          </Button>
        </Tip>
        {item.paused ? (
          <Button size="small" variant="primary" icon="check" onClick={() => void a.setPaused(item, false)}>
            {item.pausedWhy && item.pausedWhy !== CLAUDE_CHANGED ? tr('sentinel.menu.resume') : tr('sentinel.menu.turnOn')}
          </Button>
        ) : (
          <Button size="small" icon="pause" onClick={() => void a.setPaused(item, true)}>
            {tr('sentinel.menu.pause')}
          </Button>
        )}
        <ActionsDropdown items={more}>
          <IconButton icon="more" label={tr('sentinel.dash.moreFor', { name: item.name })} />
        </ActionsDropdown>
      </div>
    </header>
  );
}

/**
 * "Ask Claude about this sentinel…": one line under the header. What you say goes to the Sentinel
 * chat, which opens beside the page (naming this sentinel, so Claude knows which one): you watch it
 * change things there, and answer its approvals there.
 */
function AskBox({ item }: { item: Sentinel }) {
  const api = useApi();
  const actions = useActions();
  const active = useApp((st) => st.sentinel.chats?.active ?? FIRST_SENTINEL_CHAT);
  const a = useSentinelActions();
  // New Sentinel › Describe it: Claude writing this one from your words, its last line, then its answer.
  const ask = useApp((st) => st.sentinel.asks?.[item.id]);
  const live = useApp((st) => (ask?.state === 'writing' ? activityOf(st.log, ask.channel) : undefined));
  const line = askLine(ask, live);
  const tr = useT();
  const [text, setText] = useState('');
  const send = (): void => {
    const words = text.trim();
    if (!words) return;
    void api.session.submit(tr('sentinel.page.about', { name: item.name, words }), { channel: sentinelChatChannel(active) });
    actions.run({ type: 'view', view: { kind: 'sentinel_chat', chat: active, about: item.id } });
    setText('');
  };
  return (
    <section className={s.ask} aria-label={tr('sentinel.page.askAgent')} data-testid="sentinel-ask">
      <div className={s.askRow}>
        <ClaudeMark />
        <input
          className={s.askInput}
          value={text}
          placeholder={tr('sentinel.page.askPlaceholder')}
          aria-label={tr('sentinel.page.askLabel')}
          spellCheck
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Tip label={tr('sentinel.page.askTip')} keys="↩">
          <Button size="small" icon="arrowRight" disabled={!text.trim()} onClick={send}>
            {tr('sentinel.page.ask')}
          </Button>
        </Tip>
      </div>
      {ask ? <Attention channel={ask.channel} /> : null}
      {line && ask ? (
        <div className={s.askLine} data-who={line.who} role="status" aria-live="polite">
          {line.who === 'claude' ? <span className={s.askDot} aria-hidden="true" /> : <Icon name={line.who === 'done' ? 'check' : 'alert'} size={12} />}
          <span className={s.askText}>{line.text}</span>
          <Button size="small" variant="quiet" onClick={() => a.openChannel(ask.channel)}>
            {tr('sentinel.dash.openChat')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Banners({ item }: { item: Sentinel }) {
  const a = useSentinelActions();
  const last = useApp((st) => runsOf(st.sentinel, item.id)[0]);
  const tr = useT();
  if (item.paused && item.pausedWhy === CLAUDE_CHANGED) {
    return (
      <div className={s.banner} data-tone="info" role="status" data-testid="sentinel-claude-changed">
        <ClaudeMark />
        <span className={s.bannerText}>{CLAUDE_CHANGED_BANNER}</span>
        <Button size="small" variant="primary" onClick={() => void a.setPaused(item, false)}>
          {tr('sentinel.menu.turnOn')}
        </Button>
      </div>
    );
  }
  if (item.paused && item.pausedWhy) {
    return (
      <div className={s.banner} data-tone="error" role="status">
        <Icon name="alert" size={14} />
        <span className={s.bannerText}>
          <strong>{item.pausedWhy}.</strong> {last?.why ? tr('sentinel.page.lastOne', { why: last.why.split('\n')[0]! }) : tr('sentinel.page.lookAtLast')}
        </span>
        {last ? (
          <Button size="small" variant="quiet" onClick={() => a.openRun(last.id)}>
            {tr('sentinel.menu.openLastRun')}
          </Button>
        ) : null}
        <Button size="small" onClick={() => void a.setPaused(item, false)}>
          {tr('sentinel.menu.resume')}
        </Button>
      </div>
    );
  }
  if (item.paused) {
    return (
      <div className={s.banner} data-tone="info" role="status">
        <Icon name="pause" size={14} />
        <span className={s.bannerText}>{item.trigger.kind === 'schedule' ? tr('sentinel.page.pausedSchedule') : item.trigger.kind === 'manual' || item.trigger.kind === 'after' ? tr('sentinel.page.pausedPlain') : tr('sentinel.page.pausedEvent')}</span>
      </div>
    );
  }
  return null;
}

/** The runs: a dot strip of the last 30, then each as a row (when, by what, how it went, how long). */
function History({ item }: { item: Sentinel }) {
  const state = useSentinelState();
  const a = useSentinelActions();
  const now = useClock(true, 15_000);
  const tr = useT();
  const runs = runsOf(state, item.id);
  const dots = dotStrip(runs);
  const liveName = (r: RunSummary): string | undefined => {
    const step = state.live[r.id]?.stepId;
    return step ? item.steps.find((x) => x.id === step)?.name : undefined;
  };
  return (
    <section className={s.card} aria-label={tr('sentinel.page.history')}>
      <header className={s.cardHead}>
        <h3 className={s.cardTitle}>{tr('sentinel.page.history')}</h3>
        <span className={t.grow} />
        {runs.length ? <span className={s.hint}>{tr('sentinel.page.lastRuns', { n: runs.length })}</span> : null}
      </header>
      {!runs.length ? (
        <p className={s.empty}>{tr('sentinel.page.noRuns')}</p>
      ) : (
        <>
          <div className={s.strip} role="list" aria-label={tr('sentinel.page.stripLabel')}>
            {dots.map((d) => (
              <Tip key={d.id} label={d.label}>
                <button type="button" role="listitem" className={s.stripDot} data-tone={d.tone} aria-label={d.label} onClick={() => a.openRun(d.id)} />
              </Tip>
            ))}
          </div>
          <div className={s.runs} role="list">
            {runs.map((r) => {
              const live = r.state === 'running' ? liveName(r) : undefined;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="listitem"
                  className={s.run}
                  data-run={r.id}
                  onClick={() => a.openRun(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && primaryKey(e)) {
                      e.preventDefault();
                      const channel = r.channel ?? r.steps.find((x) => x.channel)?.channel;
                      if (chatPlaceOf(channel)) a.openChannel(channel);
                    }
                  }}
                >
                  <span className={s.runWhen}>{whenText(r.startedAt, now)}</span>
                  <span className={s.runBy}>{byWords(r, state)}</span>
                  <RunPill state={r.state} />
                  <span className={cx(s.runHeadline, live && s.runLive)}>{live ? `${live}…` : headlineOf(r)}</span>
                  <span className={s.runTook}>{durationText(runDuration(r, now))}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function Properties({ item, save }: { item: Sentinel; save: (patch: SentinelPatch) => void }) {
  const a = useSentinelActions();
  const all = useApp((st) => st.projects);
  const agents = useAgentEntries();
  const tr = useT();
  const projects = all.filter((p) => p.root && !p.error);
  const agent = sharedAgent(item.steps);
  const claudeSteps = item.steps.some((x) => x.kind === 'claude');
  const limits: number[] = TIME_LIMITS.includes(item.limits.minutes as (typeof TIME_LIMITS)[number]) ? [...TIME_LIMITS] : [...TIME_LIMITS, item.limits.minutes].sort((x, y) => x - y);
  const perDay: number[] = PER_DAY_CHOICES.includes(item.limits.perDay ?? 0) ? [...PER_DAY_CHOICES] : [...PER_DAY_CHOICES, item.limits.perDay!].sort((x, y) => x - y);
  const pauseAfter: number[] = PAUSE_AFTER_CHOICES.includes(item.limits.pauseAfter) ? [...PAUSE_AFTER_CHOICES] : [...PAUSE_AFTER_CHOICES, item.limits.pauseAfter].sort((x, y) => x - y);
  return (
    <aside className={t.props} aria-label={tr('sentinel.page.properties')}>
      <Prop label={tr('sentinel.event.project')}>
        <Select
          label={tr('sentinel.event.project')}
          size="small"
          value={item.projectId ?? MAC_SCOPE}
          options={[{ value: MAC_SCOPE, label: ASSISTANT_TITLE }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(v) => save({ projectId: v === MAC_SCOPE ? null : v })}
        />
      </Prop>
      <Prop label={tr('sentinel.page.access')}>
        <Select<Access>
          label={tr('sentinel.page.access')}
          size="small"
          value={item.access}
          options={ACCESS.map((x) => ({ value: x, label: tl('ACCESS_INFO', x, 'label', ACCESS_INFO[x].label), description: accessSentence(x, item.steps) }))}
          onChange={(access) => {
            // Less access than its steps need: say which step, before it's refused.
            if (accessRank(access) < accessRank(item.access)) {
              const needs = item.steps.find((st) => (st.kind === 'merge' && access !== 'ship') || ((st.kind === 'pr' || (st.kind === 'claude' && st.where === 'worktree')) && access === 'look'));
              if (needs) return void a.act(() => Promise.reject(new Error(tr('sentinel.page.needsMore', { step: needs.name, access: tl('ACCESS_INFO', access, 'label', ACCESS_INFO[access].label) }))));
            }
            save({ access });
          }}
        />
      </Prop>
      <p className={s.accessHint}>{tr('sentinel.cards.sentenceEnd', { text: accessSentence(item.access, item.steps) })}</p>
      {claudeSteps ? (
        <Prop label={tr('sentinel.cards.agent')}>
          <Select label={tr('sentinel.page.agentForAll')} size="small" value={agent ?? 'mixed'} placeholder={tr('sentinel.page.mixed')} options={agents} onChange={(v) => save({ steps: withAgent(item.steps, v) })} />
        </Prop>
      ) : null}
      <Prop label={tr('sentinel.page.timeLimit')}>
        <Select label={tr('sentinel.page.timeLimit')} size="small" value={String(item.limits.minutes)} options={limits.map((n) => ({ value: String(n), label: n < 60 ? tr('sentinel.page.nMinutes', { n }) : n === 60 ? tr('sentinel.cards.oneHour') : tr('sentinel.page.nHours', { n: n / 60 }), description: tr('sentinel.page.timeLimitDetail') }))} onChange={(v) => save({ limits: { minutes: Number(v) } })} />
      </Prop>
      <Prop label={tr('sentinel.page.runsPerDay')}>
        <Select label={tr('sentinel.page.runsPerDay')} size="small" value={String(item.limits.perDay ?? 0)} options={perDay.map((n) => ({ value: String(n), label: perDayLabel(n) }))} onChange={(v) => save({ limits: { perDay: Number(v) } })} />
      </Prop>
      <Prop label={tr('sentinel.page.pauseAfter')}>
        <Select label={tr('sentinel.page.pauseAfter')} size="small" value={String(item.limits.pauseAfter)} options={pauseAfter.map((n) => ({ value: String(n), label: pauseAfterLabel(n) }))} onChange={(v) => save({ limits: { pauseAfter: Number(v) } })} />
      </Prop>
      {claudeSteps ? (
        <Prop label={tr('sentinel.page.keepChats')}>
          <Select<KeepChats>
            label={tr('sentinel.page.keepChatsLabel')}
            size="small"
            value={item.keepChats ?? DEFAULT_KEEP_CHATS}
            options={KEEP_CHATS.map((k) => ({ value: k, label: tl('KEEP_CHATS_INFO', k, 'label', KEEP_CHATS_INFO[k].label), description: tl('KEEP_CHATS_INFO', k, 'description', KEEP_CHATS_INFO[k].description) }))}
            onChange={(keepChats) => save({ keepChats })}
          />
        </Prop>
      ) : null}
      <Prop label={tr('sentinel.page.notify')}>
        <Select label={tr('sentinel.page.notify')} size="small" value={item.notify} options={NOTIFY_WHERE.map((n) => ({ value: n, label: NOTIFY_LABEL[n], description: n === 'off' ? tr('sentinel.page.notifyOff') : tr('sentinel.page.notifyOn') }))} onChange={(notify) => save({ notify })} />
      </Prop>
      <div className={t.propsRule} />
      <Prop label={tr('sentinel.page.id')} quiet>
        <span className={cx(t.propStatic, t.mono, 'selectable')}>{item.id}</span>
      </Prop>
      {item.recipe ? (
        <Prop label={tr('sentinel.new.recipe')} quiet>
          <span className={t.propStatic}>{recipeById(item.recipe)?.name ?? item.recipe}</span>
        </Prop>
      ) : null}
      <Prop label={tr('sentinel.page.created')} quiet>
        <span className={t.propStatic}>{ago(item.createdAt)}</span>
      </Prop>
      <Prop label={tr('sentinel.page.changed')} quiet>
        <span className={t.propStatic}>{ago(item.updatedAt)}</span>
      </Prop>
    </aside>
  );
}

function Prop({ label, children, quiet }: { label: string; children: React.ReactNode; quiet?: boolean }) {
  return (
    <div className={cx(t.prop, quiet && t.propStaticRow)}>
      <span className={t.propLabel}>{label}</span>
      <div className={t.propControl}>{children}</div>
    </div>
  );
}
