import { useMemo, useRef, useState } from 'react';
import {
  type AfterTrigger,
  type ClaudeStep,
  type FriendStep,
  type HttpStep,
  type MergeStep,
  type MessageStep,
  type NotifyStep,
  type PrStep,
  type ScheduleTrigger,
  type ScriptStep,
  type Sentinel,
  type SentinelPatch,
  type Step,
  type TriggerStep,
  DAY_NAMES,
  SERVICE_PRESETS,
  STEP_INFO,
  accessAllows,
  ordinal,
  presetFields,
  scheduleSentence,
  stepAvailable,
  stepRefusal,
  stepSentence,
  SCRIPT_LANGUAGES,
  SCRIPT_LANGUAGE_INFO,
  type ScriptLanguage,
} from '@beluga/core/sentinel/model.js';
import { Checkbox, TextArea, TextInput } from '../components/FormSheet.js';
import { CodeEditor } from '../components/markdown/CodeEditor.js';
import { Icon } from '../components/Icon.js';
import { Select } from '../components/Select.js';
import { useAgentEntries } from '../components/agent-options.js';
import { type ActionItem, ActionsDropdown } from '../components/SpecMenu.js';
import { Button, IconButton, Segmented } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { openSheet } from '../lib/sheets.js';
import {
  AFTER_ON,
  CLAUDE_PRESETS,
  EVERY_CHOICES,
  HOURS_CHOICES,
  later as laterWords,
  STEP_ICON,
  templateHelp,
  HTTP_METHODS,
  secretsNote,
  SERVICE_CHOICES,
  WEEK,
  chatChoices,
  duplicateStep,
  headerRows,
  mergeWords,
  moveStep,
  newStep,
  otherSentinels,
  patchStep,
  rowsToHeaders,
  stepChoices,
  toggleDay,
  triggerChoices,
  triggerOfKind,
  withEvery,
  agentFields,
  stepAgentChoice,
} from './sentinel-model.js';
import { EventControls } from './EventControls.js';
import { MeasureFields } from './MeasureFields.js';
import { useDraft } from './use-draft.js';
import { sentinelGraph } from '@beluga/core/sentinel/workflow.js';
import { GraphBlock } from '../components/graph/GraphBlock.js';
import s from './sentinel.module.css';
import { THIS_COMPUTER } from '@beluga/shared/assistant.js';
import { assistantTitle } from '../lib/brand.js';
import { computerWord } from '../lib/os-words.js';
import { tl, useT } from '../i18n/index.js';
import { localSchedule } from '../lib/ci-sentinel-words.js';

/** The sentinel page's editor: When it runs, and its Steps. Everything saves as you change it. */

export type Save = (patch: SentinelPatch) => void;

const nameOf =
  (items: readonly Sentinel[]) =>
  (id: string): string | undefined =>
    items.find((i) => i.id === id)?.name;

export function WhenCard({ item, save }: { item: Sentinel; save: Save }) {
  const items = useApp((st) => st.sentinel.items);
  const tr = useT();
  const t = item.trigger;
  const choices = triggerChoices();
  return (
    <section className={s.card} aria-label={tr('sentinel.cards.when')}>
      <header className={s.cardHead}>
        <h3 className={s.cardTitle}>{tr('sentinel.cards.when')}</h3>
      </header>
      <p className={s.sentence} data-testid="sentinel-sentence">
        {localSchedule(t, nameOf(items))}
      </p>
      <div className={s.controls}>
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{tr('sentinel.event.whatStartsIt')}</span>
          <Select
            label={tr('sentinel.event.whatStartsIt')}
            size="small"
            value={t.kind}
            options={choices}
            onChange={(k) => {
              const next = triggerOfKind(k, t);
              if (next) save({ trigger: next });
            }}
          />
        </div>
        {t.kind === 'schedule' ? <ScheduleControls t={t} save={save} /> : null}
        {t.kind === 'manual' ? <p className={s.hint}>{tr('sentinel.cards.manualHint')}</p> : null}
        {t.kind === 'after' ? <AfterControls t={t} item={item} items={items} save={save} /> : null}
        {t.kind !== 'schedule' && t.kind !== 'manual' && t.kind !== 'after' ? <EventControls item={item} save={save} /> : null}
      </div>
    </section>
  );
}

function AfterControls({ t, item, items, save }: { t: AfterTrigger; item: Sentinel; items: readonly Sentinel[]; save: Save }) {
  const tr = useT();
  const others = otherSentinels(items, item.id);
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.after')}</span>
        {others.length ? (
          <Select label={tr('sentinel.cards.afterWhich')} size="small" value={t.sentinelId} placeholder={tr('sentinel.cards.pickSentinel')} options={others} onChange={(sentinelId) => save({ trigger: { ...t, sentinelId } })} />
        ) : (
          <span className={s.hint}>{tr('sentinel.cards.noOtherToFollow')}</span>
        )}
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.runs')}</span>
        <Select label={tr('sentinel.cards.whenAfter')} size="small" value={t.on} options={AFTER_ON} onChange={(on) => save({ trigger: { ...t, on } })} />
      </div>
      <p className={s.hint}>{tr('sentinel.cards.afterHint')}</p>
    </>
  );
}

function ScheduleControls({ t, save }: { t: ScheduleTrigger; save: Save }) {
  const set = (next: ScheduleTrigger): void => save({ trigger: next });
  const tr = useT();
  return (
    <>
      <div className={s.every}>
        <Segmented label={tr('sentinel.cards.howOften')} value={t.every} onChange={(every) => set(withEvery(t, every))} options={EVERY_CHOICES} />
      </div>
      {t.every === 'hours' ? (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{tr('sentinel.cards.every')}</span>
          <Select label={tr('sentinel.cards.everyHowManyHours')} size="small" value={String(t.hours ?? 1)} options={HOURS_CHOICES.map((h) => ({ value: String(h), label: tr('sentinel.cards.hours', { n: h }) }))} onChange={(h) => set({ ...t, hours: Number(h) as ScheduleTrigger['hours'] & number })} />
        </div>
      ) : (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{tr('sentinel.cards.at')}</span>
          <input
            type="time"
            className={s.time}
            aria-label={tr('sentinel.cards.atWhatTime')}
            value={t.at}
            onChange={(e) => {
              if (/^\d{2}:\d{2}$/.test(e.target.value)) set({ ...t, at: e.target.value });
            }}
          />
        </div>
      )}
      {t.every === 'week' ? (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{tr('sentinel.cards.on')}</span>
          <span className={s.days} role="group" aria-label={tr('sentinel.cards.daysOfWeek')}>
            {WEEK.map((d) => {
              const on = (t.days?.length ? t.days : [1]).includes(d);
              return (
                <button key={d} type="button" className={s.day} aria-pressed={on} onClick={() => set({ ...t, days: toggleDay(t.days, d) })}>
                  {DAY_NAMES[d]}
                </button>
              );
            })}
          </span>
        </div>
      ) : null}
      {t.every === 'month' ? (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{tr('sentinel.cards.onThe')}</span>
          <Select label={tr('sentinel.cards.dayOfMonth')} size="small" value={String(t.day ?? 1)} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) }))} onChange={(d) => set({ ...t, day: Number(d) })} />
        </div>
      ) : null}
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.asleep', { computer: computerWord() })}</span>
        <Select
          label={tr('sentinel.cards.asleep', { computer: computerWord() })}
          size="small"
          value={t.missed}
          options={[
            { value: 'catch-up', label: tr('sentinel.cards.catchUp'), description: tr('sentinel.cards.catchUpDetail') },
            { value: 'skip', label: tr('sentinel.cards.skip'), description: tr('sentinel.cards.skipDetail') },
          ]}
          onChange={(missed) => set({ ...t, missed })}
        />
      </div>
    </>
  );
}

export function StepsCard({ item, save }: { item: Sentinel; save: Save }) {
  const items = useApp((st) => st.sentinel.items);
  const [open, setOpen] = useState<string>();
  const tr = useT();
  const latest = useRef(item);
  latest.current = item;
  const setSteps = (steps: Parameters<Save>[0]['steps']): void => save({ steps });
  const change = (id: string, patch: Partial<Step>): void => setSteps(patchStep(latest.current.steps, id, patch));
  const add: ActionItem[] = stepChoices(item.access).map((c) => ({
    label: c.label,
    icon: STEP_ICON[c.kind],
    hint: c.hint,
    disabled: c.disabled,
    onSelect: () => {
      if (c.disabled) return;
      setSteps([...latest.current.steps, newStep(c.kind)]);
      // The new one opens (its id comes back from the daemon: open the last one then).
      setOpen('last');
    },
  }));
  const steps = item.steps;
  const [look, setLook] = useState<'list' | 'graph'>('list');
  return (
    <section className={s.card} aria-label={tr('sentinel.marks.steps')}>
      <header className={s.cardHead}>
        <h3 className={s.cardTitle}>{tr('sentinel.marks.steps')}</h3>
        <span className={s.grow} />
        {steps.length ? (
          <Segmented<'list' | 'graph'>
            label={tr('sentinel.cards.showStepsAs')}
            value={look}
            onChange={setLook}
            options={[
              { value: 'list', label: tr('sentinel.cards.list'), icon: 'rows' },
              { value: 'graph', label: tr('sentinel.cards.graph'), icon: 'graph' },
            ]}
          />
        ) : null}
      </header>
      {look === 'graph' && steps.length ? (
        <WorkflowGraph item={item} />
      ) : steps.length ? (
        <div className={s.steps} role="list">
          {steps.map((st, i) => (
            <StepItem
              key={st.id}
              step={st}
              index={i}
              count={steps.length}
              open={open === st.id || (open === 'last' && i === steps.length - 1)}
              toggle={() => setOpen(open === st.id || (open === 'last' && i === steps.length - 1) ? undefined : st.id)}
              item={item}
              nameOf={nameOf(items)}
              change={(patch) => change(st.id, patch)}
              move={(by) => setSteps(moveStep(latest.current.steps, i, by))}
              duplicate={() => setSteps(duplicateStep(latest.current.steps, i))}
              remove={() => setSteps(latest.current.steps.filter((x) => x.id !== st.id))}
            />
          ))}
        </div>
      ) : (
        <p className={s.empty}>{tr('sentinel.cards.noSteps')}</p>
      )}
      <div className={s.addStep}>
        <ActionsDropdown items={add} align="start">
          <Button size="small" icon="plus">
            {tr('sentinel.cards.addStep')}
          </Button>
        </ActionsDropdown>
      </div>
    </section>
  );
}

/**
 * The steps as a workflow (BLG-352): what starts it, each step with what it hands the next, where its
 * results land (dashboards, other sentinels), and its last run's states. A node's card says what it does.
 */
function WorkflowGraph({ item }: { item: Sentinel }) {
  const items = useApp((st) => st.sentinel.items);
  const runs = useApp((st) => st.sentinel.runs);
  const dashboards = useApp((st) => st.sentinel.dashboards);
  const run = useMemo(() => [...runs].reverse().find((r) => r.sentinelId === item.id), [runs, item.id]);
  const graph = useMemo(() => sentinelGraph(item, { items, ...(run ? { run } : {}), ...(dashboards ? { dashboards } : {}) }), [item, items, run, dashboards]);
  // Its layout follows its nodes and lines; a run moving along only recolours them.
  const shape = JSON.stringify([graph.nodes.map((n) => [n.id, n.label]), graph.edges.map((e) => e.id)]);
  return (
    <div className={s.workflow}>
      <GraphBlock code={JSON.stringify(graph)} shapeKey={shape} />
    </div>
  );
}

function StepItem({
  step,
  index,
  count,
  open,
  toggle,
  item,
  nameOf,
  change,
  move,
  duplicate,
  remove,
}: {
  step: Step;
  index: number;
  count: number;
  open: boolean;
  toggle: () => void;
  item: Sentinel;
  nameOf: (id: string) => string | undefined;
  change: (patch: Partial<Step>) => void;
  move: (by: number) => void;
  duplicate: () => void;
  remove: () => void;
}) {
  const name = useDraft(step.name, (v) => {
    const next = v.replace(/\s+/g, ' ').trim();
    if (next && next !== step.name) change({ name: next });
  });
  const tr = useT();
  const later = !stepAvailable(step.kind);
  const menu: ActionItem[] = [
    { label: tr('sentinel.cards.moveUp'), icon: 'up', disabled: index === 0, onSelect: () => move(-1) },
    { label: tr('sentinel.cards.moveDown'), icon: 'chevronDown', disabled: index === count - 1, onSelect: () => move(1) },
    { label: tr('sentinel.menu.duplicate'), icon: 'copy', separate: true, disabled: later, onSelect: duplicate },
    { label: tr('sentinel.cards.remove'), danger: true, separate: true, onSelect: remove },
  ];
  return (
    <div className={s.step} role="listitem" data-step={step.kind}>
      <div
        className={s.stepRow}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('input, button')) return;
          if (!later) toggle();
        }}
      >
        <span className={s.stepIndex}>{index + 1}</span>
        <span className={s.chip} data-kind={step.kind} aria-hidden="true">
          <Icon name={STEP_ICON[step.kind]} size={11} />
        </span>
        <span className={s.stepText}>
          <input
            className={s.stepName}
            value={name.text}
            aria-label={tr('sentinel.cards.stepName', { n: index + 1 })}
            spellCheck={false}
            onChange={(e) => name.change(e.target.value)}
            onBlur={name.flush}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <span className={s.stepLine}>
            {tl('STEP_INFO', step.kind, 'label', STEP_INFO[step.kind].label)} · {stepSentence(step, nameOf)}
          </span>
          {later ? <span className={s.stepLater}>{tr('sentinel.cards.laterStops', { later: laterWords() })}</span> : null}
        </span>
        {later ? null : <IconButton icon={open ? 'chevronUp' : 'chevronDown'} label={open ? tr('sentinel.cards.fold') : tr('sentinel.cards.showFields')} onClick={toggle} aria-expanded={open} />}
        <ActionsDropdown items={menu}>
          <IconButton icon="more" label={tr('sentinel.cards.moreFor', { name: step.name })} />
        </ActionsDropdown>
      </div>
      {open && !later ? (
        <div className={s.stepFields}>
          {step.kind === 'claude' ? <ClaudeFields step={step} item={item} change={change} /> : null}
          {step.kind === 'script' ? <ScriptFields step={step} change={change} /> : null}
          {step.kind === 'notify' ? <NotifyFields step={step} change={change} /> : null}
          {step.kind === 'http' ? <HttpFields step={step} change={change} /> : null}
          {step.kind === 'pr' ? <PrFields step={step} change={change} /> : null}
          {step.kind === 'merge' ? <MergeFields step={step} change={change} /> : null}
          {step.kind === 'message' ? <MessageFields step={step} change={change} /> : null}
          {step.kind === 'friend' ? <FriendFields step={step} change={change} /> : null}
          {step.kind === 'trigger' ? <TriggerFields step={step} item={item} change={change} /> : null}
          {step.kind === 'measure' ? <MeasureFields step={step} change={change} /> : null}
        </div>
      ) : null}
    </div>
  );
}

type Tr = ReturnType<typeof useT>;

const whereInfo = (tr: Tr): ReadonlyArray<{ readonly value: ClaudeStep['where']; readonly label: string; readonly description: string }> => [
  { value: 'project', label: tr('sentinel.cards.where.project'), description: tr('sentinel.cards.where.projectDetail') },
  { value: 'worktree', label: tr('sentinel.cards.where.worktree'), description: tr('sentinel.cards.where.worktreeDetail') },
  { value: 'mac', label: tr('sentinel.cards.where.mac', { mac: assistantTitle() }), description: tr('sentinel.cards.where.macDetail', { mac: assistantTitle(), computer: THIS_COMPUTER }) },
];

function ClaudeFields({ step, item, change }: { step: ClaudeStep; item: Sentinel; change: (patch: Partial<ClaudeStep>) => void }) {
  const agents = useAgentEntries();
  const tr = useT();
  const prompt = useDraft(step.prompt, (v) => v !== step.prompt && change({ prompt: v }));
  const WHERE_INFO = whereInfo(tr);
  const where = WHERE_INFO.find((w) => w.value === step.where);
  return (
    <>
      <div className={s.field}>
        <span className={s.fieldLabel}>{tr('sentinel.cards.whatAgentDoes')}</span>
        <div className={s.presets} role="group" aria-label={tr('sentinel.cards.startFrom')}>
          {CLAUDE_PRESETS.map((p) => (
            <button key={p.id} type="button" className={s.preset} onClick={() => prompt.change(p.prompt)}>
              {p.label}
            </button>
          ))}
        </div>
        <TextArea className={s.prompt} value={prompt.text} onChange={prompt.change} onBlur={prompt.flush} rows={6} aria-label={tr('sentinel.cards.agentPrompt')} placeholder={tr('sentinel.cards.agentPromptPlaceholder')} />
        <span className={s.help}>{templateHelp()}</span>
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.where')}</span>
        <Select
          label={tr('sentinel.cards.whereAgentRuns')}
          size="small"
          value={step.where}
          options={WHERE_INFO.map((w) => {
            const why = stepRefusal(item.access, 'claude', w.value);
            return { value: w.value, label: w.label, description: why ?? w.description, disabled: !accessAllows(item.access, 'claude', w.value) };
          })}
          onChange={(w) => change({ where: w })}
        />
      </div>
      {where ? <p className={s.hint}>{tr('sentinel.cards.sentenceEnd', { text: where.description })}</p> : null}
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.agent')}</span>
        {/* Which agent and model does it (BLG-497): the run's chat or worktree runs it for this step. */}
        <Select label={tr('sentinel.cards.agentAndModel')} size="small" value={stepAgentChoice(step)} options={agents} onChange={(v) => change(agentFields(v))} />
      </div>
      {step.where === 'mac' && stepAgentChoice(step) ? <p className={s.hint}>{tr('sentinel.cards.macDefaultAgent', { mac: assistantTitle() })}</p> : null}
    </>
  );
}

const TIMEOUTS = [30, 60, 120, 300, 600, 900, 1800, 3600] as const;
const timeoutLabel = (tr: Tr, sec: number): string => (sec < 60 ? tr('sentinel.cards.seconds', { n: sec }) : sec < 3600 ? tr('sentinel.cards.minutes', { n: sec / 60 }) : tr('sentinel.cards.oneHour'));

/** What a new script starts as, by language: it prints what the next step reads. */
const STARTER: Readonly<Record<ScriptLanguage, string>> = {
  python: 'import json, os\n\n# What you print is what the next step reads (a number, JSON or CSV).\nprint(json.dumps({"value": 42}))\n',
  node: '// What you print is what the next step reads (a number, JSON or CSV).\nconsole.log(JSON.stringify({ value: 42 }));\n',
  bash: '# What you print is what the next step reads (a number, JSON or CSV).\necho 42\n',
  sh: '# What you print is what the next step reads (a number, JSON or CSV).\necho 42\n',
  zsh: '# What you print is what the next step reads (a number, JSON or CSV).\necho 42\n',
  ruby: '# What you print is what the next step reads (a number, JSON or CSV).\nrequire "json"\nputs({ value: 42 }.to_json)\n',
  perl: '# What you print is what the next step reads (a number, JSON or CSV).\nprint "42\\n";\n',
};

function ScriptFields({ step, change }: { step: ScriptStep; change: (patch: Partial<ScriptStep>) => void }) {
  const tr = useT();
  const command = useDraft(step.command, (v) => v !== step.command && change({ command: v }));
  const code = useDraft(step.code ?? '', (v) => v !== (step.code ?? '') && change({ code: v }));
  const own = step.code !== undefined;
  const language = step.language ?? 'sh';
  const timeouts: number[] = TIMEOUTS.includes(step.timeoutSec as (typeof TIMEOUTS)[number]) ? [...TIMEOUTS] : [...TIMEOUTS, step.timeoutSec].sort((a, b) => a - b);
  // Its own code (BLG-350), or one shell line. Going back to a line keeps nothing of the script.
  const setMode = (mode: 'command' | 'script'): void => {
    if (mode === 'script') change({ code: step.code ?? STARTER.python, language: step.language ?? 'python', command: '' });
    else {
      const { code: _c, language: _l, ...rest } = step;
      change({ ...rest, code: undefined, language: undefined } as Partial<ScriptStep>);
    }
  };
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.itRuns')}</span>
        <Segmented<'command' | 'script'>
          label={tr('sentinel.cards.itRuns')}
          value={own ? 'script' : 'command'}
          onChange={setMode}
          options={[
            { value: 'command', label: tr('sentinel.cards.aCommand') },
            { value: 'script', label: tr('sentinel.cards.ownScript') },
          ]}
        />
      </div>
      {own ? (
        <>
          <div className={s.controlRow}>
            <span className={s.controlLabel}>{tr('sentinel.cards.language')}</span>
            <Select label={tr('sentinel.cards.language')} size="small" value={language} options={SCRIPT_LANGUAGES.map((l) => ({ value: l, label: SCRIPT_LANGUAGE_INFO[l].label }))} onChange={(l) => change({ language: l })} />
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>{tr('sentinel.cards.script')}</span>
            <CodeEditor value={code.text} onChange={code.change} onBlur={code.flush} lang={language} minRows={8} aria-label={tr('sentinel.cards.script')} />
            <span className={s.help}>{tr('sentinel.cards.scriptHelp', { run: SCRIPT_LANGUAGE_INFO[language].run })}</span>
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>{tr('sentinel.cards.arguments')}</span>
            <TextInput value={command.text} onChange={command.change} onBlur={command.flush} mono placeholder="--since yesterday" aria-label={tr('sentinel.cards.arguments')} />
          </div>
        </>
      ) : (
        <div className={s.field}>
          <span className={s.fieldLabel}>{tr('sentinel.cards.command')}</span>
          <CodeEditor value={command.text} onChange={command.change} onBlur={command.flush} lang="bash" single placeholder="npm test" aria-label={tr('sentinel.cards.command')} />
          <span className={s.help}>{tr('sentinel.cards.commandHelp')}</span>
        </div>
      )}
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.runsIn')}</span>
        <Select
          label={tr('sentinel.cards.runsIn')}
          size="small"
          value={step.cwd}
          options={[
            { value: 'project', label: tr('sentinel.cards.projectFolder') },
            { value: 'home', label: tr('sentinel.cards.homeFolder') },
          ]}
          onChange={(cwd) => change({ cwd })}
        />
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.stopAfter')}</span>
        <Select label={tr('sentinel.cards.stopAfter')} size="small" value={String(step.timeoutSec)} options={timeouts.map((n) => ({ value: String(n), label: timeoutLabel(tr, n) }))} onChange={(v) => change({ timeoutSec: Number(v) })} />
      </div>
    </>
  );
}

function NotifyFields({ step, change }: { step: NotifyStep; change: (patch: Partial<NotifyStep>) => void }) {
  const tr = useT();
  const title = useDraft(step.title ?? '', (v) => v !== (step.title ?? '') && change({ title: v }));
  const body = useDraft(step.body ?? '', (v) => v !== (step.body ?? '') && change({ body: v }));
  return (
    <>
      <div className={s.field}>
        <span className={s.fieldLabel}>{tr('sentinel.cards.title')}</span>
        <TextInput value={title.text} onChange={title.change} onBlur={title.flush} placeholder={tr('sentinel.cards.titlePlaceholder')} aria-label={tr('sentinel.cards.title')} />
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>{tr('sentinel.cards.says')}</span>
        <TextArea value={body.text} onChange={body.change} onBlur={body.flush} rows={2} placeholder={tr('sentinel.cards.saysPlaceholder')} aria-label={tr('sentinel.cards.whatItSays')} />
        <span className={s.help}>{templateHelp()}</span>
      </div>
      <Checkbox checked={step.phone} onChange={(phone) => change({ phone })} label={tr('sentinel.cards.phoneToo')} detail={tr('sentinel.cards.phoneTooDetail')} />
    </>
  );
}

// ---------------------------------------------------------------- Call a service

function HttpFields({ step, change }: { step: HttpStep; change: (patch: Partial<HttpStep>) => void }) {
  const tr = useT();
  const url = useDraft(step.url, (v) => v !== step.url && change({ url: v }));
  const body = useDraft(step.body ?? '', (v) => v !== (step.body ?? '') && change({ body: v }));
  const preset = step.preset ?? 'url';
  const own = SERVICE_PRESETS[preset].note;
  const note = own ? tl('SERVICE_PRESETS', preset, 'note', own) : own;
  const timeouts: number[] = [10, 30, 60, 120, 300, 600].includes(step.timeoutSec) ? [10, 30, 60, 120, 300, 600] : [10, 30, 60, 120, 300, 600, step.timeoutSec].sort((a, b) => a - b);
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.service')}</span>
        <Select label={tr('sentinel.cards.service')} size="small" value={preset} options={SERVICE_CHOICES} onChange={(p) => change(p === 'url' ? { preset: 'url' } : presetFields(p))} />
      </div>
      {note ? <p className={s.hint}>{note}</p> : null}
      <div className={s.field}>
        <span className={s.fieldLabel}>{tr('sentinel.event.address')}</span>
        <div className={s.urlRow}>
          <Select label={tr('sentinel.cards.method')} size="small" value={step.method} options={HTTP_METHODS.map((m) => ({ value: m, label: m }))} onChange={(method) => change({ method })} />
          <TextInput className={s.grow} value={url.text} onChange={url.change} onBlur={url.flush} mono placeholder="https://api.example.com/search" aria-label="URL" />
        </div>
      </div>
      <Headers headers={step.headers} change={(headers) => change({ headers })} />
      {step.method !== 'GET' ? (
        <div className={s.field}>
          <span className={s.fieldLabel}>{tr('sentinel.cards.body')}</span>
          <CodeEditor value={body.text} onChange={body.change} onBlur={body.flush} lang="json" placeholder={'{"query": "{{previous}}"}'} aria-label={tr('sentinel.cards.body')} />
          <span className={s.help}>{tr('sentinel.cards.bodyHelp', { help: templateHelp() })}</span>
        </div>
      ) : null}
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.giveUpAfter')}</span>
        <Select label={tr('sentinel.cards.giveUpAfter')} size="small" value={String(step.timeoutSec)} options={timeouts.map((n) => ({ value: String(n), label: timeoutLabel(tr, n) }))} onChange={(v) => change({ timeoutSec: Number(v) })} />
      </div>
      <p className={s.hint}>{tr('sentinel.cards.sentenceEnd', { text: secretsNote() })}</p>
    </>
  );
}

/** Headers as name and value rows; a new row appears as the last one is filled. */
function Headers({ headers, change }: { headers: Readonly<Record<string, string>>; change: (headers: Record<string, string>) => void }) {
  const tr = useT();
  const [rows, setRows] = useState(() => headerRows(headers));
  const latest = useRef(headers);
  // The daemon's copy changed under us (a preset): start again from it.
  if (latest.current !== headers && JSON.stringify(latest.current) !== JSON.stringify(headers)) {
    latest.current = headers;
    setRows(headerRows(headers));
  }
  const set = (i: number, patch: Partial<{ key: string; value: string }>): void => {
    const next = rows.map((r, n) => (n === i ? { ...r, ...patch } : r));
    setRows(next.at(-1)!.key || next.at(-1)!.value ? [...next, { key: '', value: '' }] : next);
  };
  const flush = (): void => {
    const next = rowsToHeaders(rows);
    if (JSON.stringify(next) !== JSON.stringify(headers)) {
      latest.current = next;
      change(next);
    }
  };
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{tr('sentinel.cards.headers')}</span>
      <div className={s.headers} role="list" aria-label={tr('sentinel.cards.headers')}>
        {rows.map((r, i) => (
          <div key={i} className={s.headerRow} role="listitem">
            <TextInput value={r.key} onChange={(key) => set(i, { key })} onBlur={flush} mono placeholder="Authorization" aria-label={tr('sentinel.cards.headerName', { n: i + 1 })} />
            <TextInput value={r.value} onChange={(value) => set(i, { value })} onBlur={flush} mono placeholder="Bearer $API_KEY" aria-label={tr('sentinel.cards.headerValue', { n: i + 1 })} />
            {r.key || r.value ? (
              <IconButton
                icon="x"
                label={tr('sentinel.cards.removeHeader', { what: r.key || tr('sentinel.cards.thisHeader') })}
                onClick={() => {
                  const next = rows.filter((_, n) => n !== i);
                  setRows(next);
                  const h = rowsToHeaders(next);
                  latest.current = h;
                  change(h);
                }}
              />
            ) : (
              <span className={s.headerSpacer} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pull requests

function PrFields({ step, change }: { step: PrStep; change: (patch: Partial<PrStep>) => void }) {
  const tr = useT();
  return (
    <>
      <Checkbox checked={Boolean(step.draft)} onChange={(draft) => change({ draft })} label={tr('sentinel.cards.prDraft')} detail={tr('sentinel.cards.prDraftDetail')} />
      <p className={s.hint}>{tr('sentinel.cards.prHint')}</p>
    </>
  );
}

function MergeFields({ step, change }: { step: MergeStep; change: (patch: Partial<MergeStep>) => void }) {
  const tr = useT();
  const setApproval = (approval: boolean): void => {
    if (approval) return change({ require: { checks: true, approval: true } });
    openSheet({
      kind: 'confirm',
      title: tr('sentinel.cards.mergeTitle'),
      message: tr('sentinel.cards.mergeMessage'),
      confirm: tr('sentinel.cards.mergeConfirm'),
      destructive: true,
      run: () => change({ require: { checks: true, approval: false } }),
    });
  };
  return (
    <>
      <Checkbox checked={step.require.approval} onChange={setApproval} label={tr('sentinel.cards.askBeforeMerge')} detail={tr('sentinel.cards.askBeforeMergeDetail', { computer: computerWord() })} />
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.mergeAs')}</span>
        <Select
          label={tr('sentinel.cards.mergeAs')}
          size="small"
          value={step.method}
          options={[
            { value: 'squash', label: tr('sentinel.cards.squash'), description: 'gh pr merge --squash' },
            { value: 'merge', label: tr('sentinel.cards.mergeCommit'), description: 'gh pr merge --merge' },
          ]}
          onChange={(method) => change({ method })}
        />
      </div>
      <p className={s.hint}>{mergeWords(step)} {tr('sentinel.cards.mergeNote')}</p>
    </>
  );
}

// ---------------------------------------------------------------- chats, friends, other sentinels

function MessageFields({ step, change }: { step: MessageStep; change: (patch: Partial<MessageStep>) => void }) {
  const network = useApp((st) => st.network);
  const tr = useT();
  const text = useDraft(step.text, (v) => v !== step.text && change({ text: v }));
  const chats = chatChoices(network);
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.writesIn')}</span>
        {chats.length ? (
          <Select label={tr('sentinel.cards.whichChat')} size="small" value={step.to} placeholder={tr('sentinel.cards.pickChat')} options={chats} onChange={(to) => change({ to })} />
        ) : (
          <span className={s.hint}>{network.enabled ? tr('sentinel.cards.noFriendsOrGroups') : tr('sentinel.cards.networkOff')}</span>
        )}
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>{tr('sentinel.cards.message')}</span>
        <TextArea value={text.text} onChange={text.change} onBlur={text.flush} rows={3} placeholder="{{sentinel}}: {{previous}}" aria-label={tr('sentinel.cards.message')} />
        <span className={s.help}>{tr('sentinel.cards.messageHelp', { help: templateHelp() })}</span>
      </div>
    </>
  );
}

function FriendFields({ step, change }: { step: FriendStep; change: (patch: Partial<FriendStep>) => void }) {
  const friends = useApp((st) => st.network.friends);
  const tr = useT();
  const prompt = useDraft(step.prompt, (v) => v !== step.prompt && change({ prompt: v }));
  const project = useDraft(step.project ?? '', (v) => v !== (step.project ?? '') && change({ project: v || undefined }));
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.whoseAgent')}</span>
        {friends.length ? (
          <Select label={tr('sentinel.cards.whoseAgent')} size="small" value={step.peerId} placeholder={tr('sentinel.cards.pickFriend')} options={[...friends].sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ value: f.peerId, label: f.name }))} onChange={(peerId) => change({ peerId })} />
        ) : (
          <span className={s.hint}>{tr('sentinel.cards.noFriends')}</span>
        )}
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>{tr('sentinel.cards.whatToAsk')}</span>
        <TextArea value={prompt.text} onChange={prompt.change} onBlur={prompt.flush} rows={4} placeholder={tr('sentinel.cards.whatToAskPlaceholder')} aria-label={tr('sentinel.cards.whatToAsk')} />
        <span className={s.help}>{templateHelp()}</span>
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.inTheirProject')}</span>
        <TextInput value={project.text} onChange={project.change} onBlur={project.flush} placeholder={tr('sentinel.cards.anyTheirChoice')} aria-label={tr('sentinel.cards.theirProject')} />
      </div>
      <p className={s.hint}>{tr('sentinel.cards.friendHint')}</p>
    </>
  );
}

function TriggerFields({ step, item, change }: { step: TriggerStep; item: Sentinel; change: (patch: Partial<TriggerStep>) => void }) {
  const items = useApp((st) => st.sentinel.items);
  const tr = useT();
  const others = otherSentinels(items, item.id);
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.cards.runs')}</span>
        {others.length ? <Select label={tr('sentinel.cards.whichSentinel')} size="small" value={step.sentinelId} placeholder={tr('sentinel.cards.pickSentinel')} options={others} onChange={(sentinelId) => change({ sentinelId })} /> : <span className={s.hint}>{tr('sentinel.cards.noOther')}</span>}
      </div>
      <p className={s.hint}>{tr('sentinel.cards.triggerHint')}</p>
    </>
  );
}
