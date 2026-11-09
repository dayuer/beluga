import * as Popover from '@radix-ui/react-popover';
import { EFFORTS, type Effort } from '@beluga/shared/settings-schema.js';
import { type CSSProperties, useState } from 'react';
import type { AppState } from '@beluga/core/store.js';
import { type AgentRef, CLAUDE_AGENT } from '@beluga/protocol.js';
import { type HandoffMode, limitHit, needsHandoff } from '@beluga/shared/agent-handoff.js';
import { type AgentMark, modelMark, runtimeMark } from '@beluga/shared/agent-marks.js';
import { type AgentPicker, type PickerGroup, type PickerState, agentPicker, pickAction } from '@beluga/shared/agent-picker.js';
import type { RuntimeModel } from '@beluga/shared/agent-runtimes.js';
import type { AgentOption } from '@beluga/ui/agent-choice.js';
import { Icon } from '../components/Icon.js';
import type { SelectEntry } from '../components/Select.js';
import { cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { t as tNow, useT } from '../i18n/index.js';
import s from './picker.module.css';
import { localModelDescription, localModelName } from '../lib/engine-words.js';

type Api = ReturnType<typeof useApi>;
type Prefs = AppState['prefs'];

/** Your agent's runtime: it runs every conversation that picked none of its own, and answers @you (Claude until you pick another). */
export const myRuntime = (prefs: Prefs): string => prefs.defaultAgent?.runtime ?? CLAUDE_AGENT.runtime;

/** Your agent's model ('' its runtime's default): Claude's is the model setting, another runtime's comes with the agent. */
export function myModel(prefs: Prefs): string {
  const agent = prefs.defaultAgent;
  if (agent && agent.runtime !== CLAUDE_AGENT.runtime) return agent.model ?? '';
  return agent?.model ?? prefs.model ?? '';
}

/**
 * Makes `runtime` (with `model`) your agent. Claude's model stays in the model setting, where the
 * composer and the model sheet change it, so there's one place for it; another runtime's model
 * goes with the agent (the model setting is Claude's only).
 */
export function setMyAgent(api: Api, runtime: string, label: string, model: string): void {
  if (runtime === CLAUDE_AGENT.runtime) {
    void api.session.setPrefs({ defaultAgent: null });
    void api.workbench.setModel(undefined, model);
  } else void api.session.setPrefs({ defaultAgent: { runtime, label, ...(model ? { model } : {}) } });
}

/** The picker's view of the state: "your default model" is your agent's, whichever runtime it is. */
export const pickerState = (st: AppState): PickerState => ({ ...st, prefs: { model: myModel(st.prefs) || undefined } });

/** A model's details (its effort levels) by runtime and value; Claude's come from Claude Code itself. */
export function modelInfo(st: Pick<AppState, 'runtimes' | 'models'>, runtime: string, model: string): RuntimeModel | undefined {
  const models = runtime === CLAUDE_AGENT.runtime ? st.models : (st.runtimes.find((r) => r.id === runtime)?.models ?? []);
  return models.find((m) => m.value === model);
}

/** The maker a runtime's models usually come from: its own models carry no second mark. */
const HOUSE: Readonly<Record<string, AgentMark>> = { claude: 'anthropic', codex: 'openai', opencode: 'opencode', copilot: 'copilot' };

/** A model's maker mark when it isn't its runtime's own (a local runtime serving a GPT model); else none. */
export function foreignMark(model: string, runtime: string): AgentMark | undefined {
  if (!model) return undefined;
  const mark = modelMark(model, runtime);
  return mark === (HOUSE[runtime] ?? 'localModel') ? undefined : mark;
}

/**
 * The agents (agentChoices) as a pop-up's entries: a section per runtime, each row with the
 * runtime's mark before its name. In a section a row says the model alone ("Opus"); the button
 * says both ("Claude · Opus"). A runtime that isn't set up is one greyed row saying what's missing.
 */
export function agentEntries(options: readonly AgentOption[]): SelectEntry<string>[] {
  const groups = [...new Set(options.map((o) => o.group))];
  return groups.map((group) => ({
    section: group,
    options: options
      .filter((o) => o.group === group)
      .map((o) => {
        const name = o.model ? o.label.slice(`${o.group} · `.length) || o.label : o.group;
        const why = o.why ?? (o.model ? undefined : o.disabled ? undefined : tNow('chat.modelPicker.ownDefault'));
        return { value: o.value, label: localModelName(name), short: localModelName(o.label), icon: o.mark, keywords: [o.group], ...(why ? { description: why } : {}), ...(o.disabled ? { disabled: true } : {}) };
      }),
  }));
}

/** Effort, in plain words, with what each level means (the same five steps for every agent). Read when shown, in the language shown then. */
export const EFFORT_INFO: Readonly<Record<Effort, { readonly label: string; readonly detail: string }>> = Object.fromEntries(
  EFFORTS.map((e) => [
    e,
    {
      get label() {
        return tNow(`chat.modelPicker.${e}Label`);
      },
      get detail() {
        return tNow(`chat.modelPicker.${e}Detail`);
      },
    },
  ]),
) as Record<Effort, { readonly label: string; readonly detail: string }>;

/** A friendlier word for a model, from its name (Opus is the most capable, Haiku the fastest). */
function flavor(value: string, label: string, runtime: string): string {
  const v = `${value} ${label}`.toLowerCase();
  if (v.includes('opus')) return tNow('chat.modelPicker.mostCapable');
  if (v.includes('sonnet')) return tNow('chat.modelPicker.fastCapable');
  if (v.includes('haiku')) return tNow('chat.modelPicker.fastest');
  return value ? '' : tNow('chat.modelPicker.chooses', { runtime });
}

export const samePicker = (a: AgentPicker, b: AgentPicker): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What a move to another runtime needs to know of a conversation: whose session it holds, and whether its agent is at its plan limit. */
interface Carried {
  readonly live: boolean;
  readonly sessionRuntime?: string;
  readonly limited: boolean;
}

function carriedOf(st: AppState, channel: string): Carried {
  const id = channel.startsWith('ws:') ? channel.slice(3) : undefined;
  const ws = id ? st.projects.flatMap((p) => p.workspaces).find((w) => w.id === id) : undefined;
  if (!ws || (!ws.sessionId && !ws.forkFromSession)) return { live: false, limited: false };
  return { live: true, ...(ws.sessionRuntime ? { sessionRuntime: ws.sessionRuntime } : {}), limited: limitHit(st.log, channel) !== undefined };
}

const sameCarried = (a: Carried, b: Carried): boolean => a.live === b.live && a.sessionRuntime === b.sessionRuntime && a.limited === b.limited;

/** A move waiting on how (BLG-592): to an agent that can't read this conversation's session. */
interface Move {
  readonly agent: AgentRef | null;
  readonly to: string;
  readonly from: string;
}

/**
 * The agent for this conversation, and how hard it thinks, in one compact popover (BLG-446): the
 * agents down a rail on the left (each with its mark, a dot on the one at work here, greyed when it
 * isn't set up), the shown agent's models on the right, one line each with what they're good at,
 * scrolling inside a popover that never outgrows the window; effort below, Auto then Low to Max
 * on one track, what the level means above it. `draft`: a new worktree's pick (it has no conversation yet), kept by the New Worktree box.
 */
export function ModelPicker({ channel, draft, onDraft }: { channel: string; draft?: AgentRef; onDraft?: (agent: AgentRef | undefined) => void }) {
  const api = useApi();
  const t = useT();
  // Only what the picker shows (not the whole state): not drawn again on every streamed event (KLD-48).
  const picker = useApp((st) => agentPicker(pickerState(st), channel, myRuntime(st.prefs), draft), samePicker);
  const effort = useApp((st) => st.prefs.effort);
  const carried = useApp((st) => carriedOf(st, channel), sameCarried);
  const [seen, setSeen] = useState<string>();
  const [move, setMove] = useState<Move>();
  const conversation = picker.conversation;
  const groups = picker.groups;
  const home = groups.find((g) => g.isDefault);
  const model = groups.find((g) => g.current)?.models.find((m) => m.on);
  // Some models take only some effort levels.
  const allowed = new Set((model?.efforts ?? EFFORTS) as readonly string[]);
  const label = localModelName(picker.label);
  const chip = `${label}${effort ? ` · ${EFFORT_INFO[effort].label}` : ''}`;
  const pick = (g: PickerGroup, value: string): void => {
    if (onDraft && !conversation) {
      // A new worktree: your default's model is the default for new ones; another runtime is this worktree's own.
      if (g.isDefault) {
        onDraft(undefined);
        setMyAgent(api, g.runtime, g.label, value);
      } else onDraft({ runtime: g.runtime, label: g.label, ...(value ? { model: value } : {}) });
      return;
    }
    const action = pickAction(picker, g, value);
    // New conversations: your agent's model (Claude's is the model setting; another runtime's goes with the agent).
    if (action?.kind === 'model' && !conversation) setMyAgent(api, g.runtime, g.label, action.value);
    else if (action?.kind === 'model') void api.workbench.setModel(conversation, action.value);
    else if (action?.kind === 'agent' && conversation) {
      // The new agent can't read this conversation: you choose how it goes on (BLG-592).
      const live = { sessionId: 'live', ...(carried.sessionRuntime ? { sessionRuntime: carried.sessionRuntime } : {}) };
      if (carried.live && needsHandoff(live, g.runtime)) setMove({ agent: action.agent, to: g.label, from: groups.find((x) => x.current)?.label ?? t('chat.modelPicker.yourAgent') });
      else void api.workbench.setAgent(conversation, action.agent);
    }
  };
  const moveWith = (mode: HandoffMode): void => {
    if (move && conversation) void api.workbench.setAgent(conversation, move.agent, mode);
    setMove(undefined);
  };
  // The agent whose models show: the one at work here, until you look at another.
  const shown = groups.find((g) => g.runtime === seen) ?? groups.find((g) => g.current) ?? home ?? groups[0];
  const rows = (g: PickerGroup) => (
    <div className={s.models} role="radiogroup" aria-label={t('chat.modelPicker.models', { name: g.label })}>
      {g.models.map((m) => {
        const maker = foreignMark(m.value, g.runtime);
        const desc = m.why ?? (m.description || flavor(m.value, m.label, g.label));
        return (
          <button key={m.value || 'default'} type="button" role="radio" aria-checked={m.on} disabled={Boolean(m.why) && !m.on} title={desc || m.label} className={cx(s.model, m.on && s.modelOn, m.why && s.modelOff)} onClick={() => pick(g, m.value)}>
            <span className={s.radio}>{m.on ? <Icon name="check" size={9} /> : null}</span>
            {maker ? <Icon name={maker} size={12} className={s.maker} /> : null}
            <span className={s.modelName}>{localModelName(m.label)}</span>
            {desc ? <span className={s.modelDesc}>{m.why ? desc : localModelDescription(m.description ?? '') || desc}</span> : null}
          </button>
        );
      })}
    </div>
  );
  // Narrow (a side panel): the effort alone, the whole of it in the tooltip; never two lines.
  const words = effort ? (
    <>
      <span className={s.chipModel}>{label} · </span>
      {EFFORT_INFO[effort].label}
    </>
  ) : (
    label
  );
  const level = effort ? EFFORTS.indexOf(effort) : -1;
  return (
    <Popover.Root onOpenChange={(open) => !open && (setMove(undefined), setSeen(undefined))}>
      <Popover.Trigger asChild>
        <button type="button" className={s.chip} aria-label={t('chat.modelPicker.chipAria')} title={chip} data-shrink="">
          <Icon name={runtimeMark(picker.runtime)} size={12} />
          <span className={s.chipText}>{words}</span>
          <Icon name="chevronDown" size={9} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={s.popover} side="top" align="start" sideOffset={8} collisionPadding={12}>
          {move ? (
            <MoveChoice move={move} limited={carried.limited} onPick={moveWith} onBack={() => setMove(undefined)} />
          ) : (
            <>
              <div className={s.heading}>
                {t('chat.modelPicker.agent')}
                <span className={s.scope}>{conversation ? t('chat.modelPicker.forConversation') : onDraft ? t('chat.modelPicker.forWorktree') : t('chat.modelPicker.forNew')}</span>
              </div>
              <div className={s.body}>
                <div className={s.rail} role="tablist" aria-label={t('chat.modelPicker.agents')} aria-orientation="vertical">
                  {groups.map((g) => (
                    <button
                      key={g.runtime}
                      type="button"
                      role="tab"
                      aria-selected={g === shown}
                      aria-label={g.label}
                      title={g.available ? (g.current ? t('chat.modelPicker.atWork', { name: g.label }) : g.label) : g.why}
                      className={cx(s.agent, g === shown && s.agentOn, !g.available && s.agentOff)}
                      onClick={() => setSeen(g.runtime)}
                    >
                      <Icon name={runtimeMark(g.runtime)} size={13} className={s.agentMark} />
                      <span className={s.agentName}>{g.label}</span>
                      {g.current ? <span className={s.inUse} aria-hidden /> : null}
                    </button>
                  ))}
                </div>
                <div className={s.pane} role="tabpanel" aria-label={shown?.label ?? t('chat.modelPicker.modelsTab')}>
                  {shown ? (shown.available ? rows(shown) : <div className={s.why}>{shown.why}</div>) : null}
                </div>
              </div>
              <div className={s.thinking}>
                <div className={s.thinkingHead}>
                  <span className={s.thinkingLabel}>{t('chat.modelPicker.thinking')}</span>
                  <span className={s.thinkingDetail}>{effort ? EFFORT_INFO[effort].detail : t('chat.modelPicker.autoDetail')}</span>
                </div>
                {/* Auto, then Low to Max: a thumb that slides to the level picked, a warm fill behind it as deep as the level. */}
                <div className={s.track} role="radiogroup" aria-label={t('chat.modelPicker.effortAria')} style={{ '--at': level + 1, '--heat': level < 0 ? 0 : (level + 1) / EFFORTS.length } as CSSProperties}>
                  <span className={s.fill} aria-hidden />
                  <span className={s.thumb} aria-hidden />
                  <button type="button" role="radio" aria-checked={!effort} className={cx(s.level, !effort && s.levelOn)} title={t('chat.modelPicker.autoDetail')} onClick={() => void api.session.setPrefs({ effort: null })}>
                    {t('chat.modelPicker.auto')}
                  </button>
                  {EFFORTS.map((e) => (
                    <button key={e} type="button" role="radio" aria-checked={effort === e} disabled={!allowed.has(e)} title={allowed.has(e) ? EFFORT_INFO[e].detail : t('chat.modelPicker.noLevel')} className={cx(s.level, effort === e && s.levelOn)} onClick={() => void api.session.setPrefs({ effort: e })}>
                      {EFFORT_INFO[e].label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Moving a conversation to an agent that can't read its session (BLG-592): switch now, the new
 * agent getting the recent conversation with your next message; or have the old agent write a
 * handoff note first, on its own plan. An agent at its plan limit can't write one.
 */
function MoveChoice({ move, limited, onPick, onBack }: { move: Move; limited: boolean; onPick: (mode: HandoffMode) => void; onBack: () => void }) {
  const t = useT();
  return (
    <>
      <div className={s.heading}>
        <button type="button" className={s.back} aria-label={t('chat.modelPicker.back')} onClick={onBack}>
          <Icon name="back" size={11} />
        </button>
        {t('chat.modelPicker.moveTo', { to: move.to })}
      </div>
      <div className={s.why}>
        {t('chat.modelPicker.cantRead', { to: move.to, from: move.from })}
      </div>
      <div className={s.choices} role="group" aria-label={t('chat.modelPicker.howToMove', { to: move.to })}>
        <button type="button" className={s.choice} onClick={() => onPick('quiet')} autoFocus>
          <span className={s.choiceIcon}>
            <Icon name="arrowRight" size={12} />
          </span>
          <span className={s.choiceText}>
            <span className={s.choiceName}>{t('chat.modelPicker.justSwitch')}</span>
            <span className={s.choiceDesc}>{t('chat.modelPicker.justSwitchDetail', { to: move.to })}</span>
          </span>
        </button>
        <button type="button" className={cx(s.choice, limited && s.modelOff)} disabled={limited} onClick={() => onPick('note')}>
          <span className={s.choiceIcon}>
            <Icon name="pencil" size={12} />
          </span>
          <span className={s.choiceText}>
            <span className={s.choiceName}>{t('chat.modelPicker.handoff')}</span>
            <span className={s.choiceDesc}>{limited ? t('chat.modelPicker.handoffLimited', { from: move.from }) : t('chat.modelPicker.handoffDetail', { from: move.from })}</span>
          </span>
        </button>
      </div>
    </>
  );
}
