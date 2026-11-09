import { type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AUTONOMIES, type Autonomy, DEFAULT_AUTONOMY, TESTS_AT, type TestsAt } from '@beluga/core/plans/model.js';
import { agentForChoice } from '@beluga/ui/agent-choice.js';
import { Field, FormSheet, Popup, TextArea } from '../components/FormSheet.js';
import { YOUR_AGENT, useAgentEntries } from '../components/agent-options.js';
import { Icon, type IconName } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { RunsOnRow } from '../chat/RunsOn.js';
import { myRuntime } from '../chat/ModelPicker.js';
import { sendToComputer, useStartDeps } from '../machines/start-there.js';
import { useTasksPrefs } from '../tasks/use-tasks.js';
import { autonomyInfo, modeChange, testsAtInfo } from './plans-model.js';
import { useT } from '../i18n/index.js';
import { usePlanActions, usePlanView, usePlans } from './use-plans.js';
import p from './plans.module.css';
import { chordLabel } from '../lib/shortcuts-model.js';
import { useActions } from '../lib/actions.js';

const AUTONOMY_ICON: Record<Autonomy, IconName> = { step: 'hand', gated: 'flag', autopilot: 'wand' };

/**
 * A new plan: what it's for (Claude plans from it, reading the code) and how far it runs on its
 * own. Opened from a project it's that project's (no picker). More options: who works its
 * milestones and tasks (BLG-497; your default agent unless you pick another).
 */
export function NewPlanSheet({ projectId, close }: { projectId?: string; close: () => void }) {
  const startDeps = useStartDeps();
  const prefsNow = () => startDeps.home.store.getState().prefs;
  const prefs = useTasksPrefs();
  const all = useApp((s) => s.projects);
  const projects = useMemo(() => all.filter((p) => p.root && !p.error), [all]);
  const { api, act } = usePlanActions();
  const actions = useActions();
  const [goal, setGoal] = useState('');
  const known = projectId !== undefined && projects.some((p) => p.id === projectId);
  const [project, setProject] = useState((known ? projectId : projects.some((p) => p.id === prefs.project) ? prefs.project : projects[0]?.id) ?? '');
  const [autonomy, setAutonomy] = useState<Autonomy>(DEFAULT_AUTONOMY);
  const [testsAt, setTestsAt] = useState<TestsAt>('milestone');
  const agents = useAgentEntries();
  const runtimes = useApp((s) => s.runtimes);
  const [agent, setAgent] = useState(YOUR_AGENT);
  const [more, setMore] = useState(false);
  const t = useT();
  if (!projects.length) {
    // The sidebar's own "Add a Project…", one click away (every OS has it; not every one has a File menu).
    const addProject = (): void => {
      close();
      actions.run({ type: 'add_project' });
    };
    return <FormSheet title={t('plans.sheets.newPlan')} intro={t('plans.sheets.noProject')} submitLabel={t('plans.sheets.addProject')} onSubmit={addProject} onCancel={close} />;
  }
  const name = projects.find((p) => p.id === project)?.name;
  return (
    <FormSheet
      title={name ? t('plans.sheets.planIn', { name }) : t('plans.sheets.newPlan')}
      icon="flag"
      intro={t('plans.sheets.newPlanIntro')}
      submitLabel={t('plans.sheets.planWithAgent')}
      width={600}
      canSubmit={Boolean(goal.trim() && project)}
      onCancel={close}
      onSubmit={async () => {
        const chosen = agent !== YOUR_AGENT ? agentForChoice(agent, runtimes) : undefined;
        const input = { goal: goal.trim(), autonomy, testsAt, ...(chosen ? { agent: chosen } : {}) };
        // Runs on one of your computers (BLG-788): the plan is made there and opens at once; held, the sheet stays.
        const sent = sendToComputer(startDeps, project, chosen?.runtime ?? myRuntime(prefsNow()), { kind: 'plan', input });
        if (sent === 'held') return;
        close();
        if (sent === 'sent') return;
        await act(() => api.create({ projectId: project, ...input }));
      }}
    >
      <div className={p.newPlan}>
        <label className={p.newPlanLabel} htmlFor="plan-goal">
          {t('plans.details.goal')}
        </label>
        <GoalBox value={goal} onChange={setGoal} />
        <div className={p.newPlanHint}>{t('plans.sheets.goalHint', { keys: chordLabel('Cmd+Enter') })}</div>
        {known ? null : (
          <div className={p.newPlanRow}>
            <span className={p.newPlanLabel}>{t('plans.sheets.project')}</span>
            <Popup label={t('plans.sheets.project')} value={project} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={setProject} />
          </div>
        )}
        {/* Where it runs (BLG-786): the plan and its worktrees. Only with a computer paired. */}
        <RunsOnRow project={project} className={p.newPlanRow} labelClassName={p.newPlanLabel} />
        <div className={p.newPlanLabel} id="plan-runs">
          {t('plans.sheets.howItRuns')}
        </div>
        <AutonomyCards value={autonomy} onChange={setAutonomy} />
        <div className={p.newPlanRow}>
          <span className={p.newPlanLabel}>{t('plans.sheets.whenTests')}</span>
          <Popup label={t('plans.sheets.whenTests')} value={testsAt} options={TESTS_AT.map((x) => ({ value: x, label: testsAtInfo(x).label }))} onChange={setTestsAt} />
        </div>
        <div className={p.newPlanHint}>{t('plans.sheets.hint', { hint: testsAtInfo(testsAt).hint })}</div>
        <button type="button" className={p.newPlanMore} aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon name={more ? 'chevronDown' : 'chevronRight'} size={10} />
          {t('plans.sheets.moreOptions')}
        </button>
        {more ? (
          <>
            <div className={p.newPlanRow}>
              <span className={p.newPlanLabel}>{t('plans.sheets.agent')}</span>
              <Popup label={t('plans.sheets.agent')} value={agent} options={agents} onChange={setAgent} />
            </div>
            <div className={p.newPlanHint}>{t('plans.sheets.agentHint')}</div>
          </>
        ) : null}
      </div>
    </FormSheet>
  );
}

/** The goal: six lines to start, growing with what you write (to about 60% of the sheet, then it scrolls). */
function GoalBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const t = useT();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <TextArea
      ref={ref}
      id="plan-goal"
      className={p.goalBox}
      value={value}
      onChange={onChange}
      rows={6}
      placeholder={t('plans.sheets.goalPlaceholder')}
      data-autofocus
    />
  );
}

/** Step by Step, Check-ins, Autopilot: three cards you can read without hovering (a radio group; the arrows move). */
function AutonomyCards({ value, onChange, current }: { value: Autonomy; onChange: (a: Autonomy) => void; current?: Autonomy }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const t = useT();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = AUTONOMIES[(AUTONOMIES.indexOf(value) + step + AUTONOMIES.length) % AUTONOMIES.length]!;
    onChange(next);
    refs.current[AUTONOMIES.indexOf(next)]?.focus();
  };
  return (
    <div className={p.modeCards} role="radiogroup" aria-labelledby="plan-runs" onKeyDown={onKeyDown}>
      {AUTONOMIES.map((a, i) => {
        const on = a === value;
        return (
          <button
            key={a}
            ref={(el) => void (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={cx(p.modeCard, on && p.modeCardOn)}
            onClick={() => onChange(a)}
          >
            <span className={p.modeIcon} aria-hidden="true">
              <Icon name={AUTONOMY_ICON[a]} size={16} />
            </span>
            <span className={p.modeName}>{autonomyInfo(a).label}</span>
            <span className={p.modeSummary}>{autonomyInfo(a).summary}</span>
            {a === current ? <span className={p.modeNow}>{t('plans.details.flow.active')}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * How a running plan runs: the same three cards as a new plan. Picking another one says, in plain
 * words, what changes from now on (and what happens at once); Switch applies it and it's in the feed.
 */
export function PlanModeSheet({ planId, close }: { planId: string; close: () => void }) {
  const plan = usePlans().plans.find((x) => x.id === planId);
  const view = usePlanView(plan);
  const { api, act } = usePlanActions();
  const [mode, setMode] = useState<Autonomy>(plan?.autonomy ?? DEFAULT_AUTONOMY);
  const t = useT();
  if (!plan || !view) return <FormSheet title={t('plans.sheets.howItRunsTitle')} intro={t('plans.sheets.gone')} submitLabel={t('plans.sheets.ok')} hideSubmit onSubmit={close} onCancel={close} />;
  const mixed = plan.body?.milestones.some((m) => m.autonomy && m.autonomy !== plan.autonomy);
  const change = mode !== plan.autonomy || mixed ? modeChange(view, mode) : undefined;
  return (
    <FormSheet
      title={t('plans.sheets.howItRunsTitle')}
      icon="flag"
      intro={t('plans.sheets.modeIntro', { title: plan.body?.title ?? plan.draft?.title ?? t('plans.sheets.thisPlan'), mode: autonomyInfo(plan.autonomy).label })}
      submitLabel={change?.title ?? t('plans.sheets.switch')}
      canSubmit={Boolean(change)}
      width={600}
      onCancel={close}
      onSubmit={async () => {
        close();
        await act(() => api.setAutonomy(plan.id, mode), t('plans.sheets.toast.runsOn', { mode: autonomyInfo(mode).label }));
      }}
    >
      <div className={p.newPlan}>
        <div className={p.newPlanLabel} id="plan-runs">
          {t('plans.sheets.howItRuns')}
        </div>
        <AutonomyCards value={mode} onChange={setMode} current={plan.autonomy} />
        {change ? (
          <div className={p.modeConfirm} role="status" aria-label={t('plans.sheets.whatChanges')}>
            <p>{change.from}</p>
            {change.now ? <p className={p.modeConfirmNow}>{change.now}</p> : null}
          </div>
        ) : (
          <p className={p.newPlanHint}>{t('plans.sheets.hint', { hint: autonomyInfo(plan.autonomy).hint })}</p>
        )}
      </div>
    </FormSheet>
  );
}

/** How you like plans cut: added to Claude's planning instructions every time. */
export function PlanStyleSheet({ close }: { close: () => void }) {
  const style = usePlans().style;
  const { api, act } = usePlanActions();
  const [text, setText] = useState(style);
  const t = useT();
  return (
    <FormSheet
      title={t('plans.sheets.styleTitle')}
      icon="flag"
      intro={t('plans.sheets.styleIntro')}
      submitLabel={t('plans.sheets.save')}
      onCancel={close}
      onSubmit={async () => {
        close();
        await act(() => api.setStyle(text), t('plans.sheets.toast.styleSaved'));
      }}
    >
      <Field label={t('plans.sheets.style')} htmlFor="plan-style" hint={t('plans.sheets.styleHint')}>
        <TextArea id="plan-style" value={text} onChange={setText} rows={9} placeholder={t('plans.sheets.stylePlaceholder')} data-autofocus />
      </Field>
    </FormSheet>
  );
}

/** Not yet: what a milestone still needs. The plan's head Claude adds the work for it. */
export function SendBackSheet({ planId, milestone, close }: { planId: string; milestone: string; close: () => void }) {
  const t = useT();
  const title = usePlans().plans.find((p) => p.id === planId)?.body?.milestones.find((m) => m.id === milestone)?.title ?? t('plans.sheets.thisMilestone');
  const { api, act } = usePlanActions();
  const [note, setNote] = useState('');
  return (
    <FormSheet
      title={t('plans.sheets.notYetTitle', { title })}
      icon="flag"
      intro={t('plans.sheets.notYetIntro')}
      submitLabel={t('plans.sheets.sendToAgent')}
      canSubmit={Boolean(note.trim())}
      onCancel={close}
      onSubmit={async () => {
        close();
        await act(() => api.sendBack(planId, milestone, note.trim()));
      }}
    >
      <Field label={t('plans.sheets.whatsMissing')} htmlFor="plan-note">
        <TextArea id="plan-note" value={note} onChange={setNote} rows={4} placeholder={t('plans.sheets.notYetPlaceholder')} data-autofocus />
      </Field>
    </FormSheet>
  );
}
