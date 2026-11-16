import { useMemo, useState } from 'react';
import { t } from '../../i18n/index.js';
import { AUTONOMIES, AUTONOMY_INFO, type Autonomy, TESTS_AT, TESTS_AT_INFO, type TestsAt } from '@beluga/core/plans/model.js';
import { agentForChoice } from '@beluga/ui/agent-choice.js';
import { planRoleDefaults } from '@beluga/shared/auto-route.js';
import { useDefaultAutonomy } from '../../plans/use-default-autonomy.js';
import { PLAN_ROLES, type PlanRole, roleStart, rolesInput } from '../../plans/plan-roles-model.js';
import { PlanRoles } from '../../plans/PlanRoles.js';
import { AUTONOMY_ICON, AutonomyCards, GoalBox } from '../../plans/PlanSheets.js';
import { FormSheet, Popup } from '../../components/FormSheet.js';
import { Icon } from '../../components/Icon.js';
import { useApp } from '../../lib/beluga.js';
import { RunsOnRow } from '../../chat/RunsOn.js';
import { myRuntime } from '../../chat/ModelPicker.js';
import { sendToComputer, useStartDeps } from '../../machines/start-there.js';
import { useTasksPrefs } from '../../tasks/use-tasks.js';
import { usePlanActions } from '../../plans/use-plans.js';
import p from '../../plans/plans.module.css';
import { chordLabel } from '../../lib/shortcuts-model.js';
import { useActions } from '../../lib/actions.js';
import { choicesOf, nativeSheets, useNativeSheet } from '../../lib/native-sheet.js';
import { useAgentEntries } from '../../components/agent-options.js';
import { ROLE_INFO } from '../../plans/plan-roles-model.js';
import { roleEntries } from '../../plans/PlanRoles.js';
import { useRunsOn } from '../../chat/RunsOn.js';
import { HERE, type RunsOn, runsOnRows } from '../../machines/runs-on-model.js';
import { MachineMark } from '../../machines/MachineMark.js';
import { thisComputer, upFirst } from '../../lib/os-words.js';

// Fork (plan roles, PR #17 and #20): New Plan with a pop-up per role, in place of upstream's one
// Agent pop-up (plans/PlanSheets.tsx's NewPlanSheet, kept as it is upstream). fork/sheets.tsx opens
// this one for the 'new_plan' sheet. When upstream changes its NewPlanSheet, bring the change here.

/**
 * A new plan: what it's for (Claude plans from it, reading the code) and how far it runs on its
 * own. Opened from a project it's that project's (no picker). More options: who does each part
 * of it (BLG-497), as the tiers say unless you pick another: the strongest model designs it and
 * takes over what's hard, an everyday one writes the code, one between checks it (plan-roles-model.ts).
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
  const startsAs = useDefaultAutonomy();
  const [autonomy, setAutonomy] = useState<Autonomy>(startsAs);
  const [testsAt, setTestsAt] = useState<TestsAt>('milestone');
  const runtimes = useApp((s) => s.runtimes);
  const route = useApp((s) => s.prefs.autoRoute);
  const tiers = useMemo(() => planRoleDefaults(route, runtimes), [route, runtimes]);
  // Each role's pick (undefined: where the tiers start it, which follows your models as they come and go).
  const [picked, setPicked] = useState<Partial<Record<PlanRole, string>>>({});
  const picks = Object.fromEntries(PLAN_ROLES.map((r) => [r, picked[r] ?? roleStart(r, tiers)])) as Record<PlanRole, string>;
  const [more, setMore] = useState(false);
  // The sidebar's own "Add a Project…", one click away (every OS has it; not every one has a File menu).
  const addProject = (): void => {
    close();
    actions.run({ type: 'add_project' });
  };
  const create = async (): Promise<void> => {
    const roles = rolesInput(picks, tiers, (v) => agentForChoice(v, runtimes));
    const input = { goal: goal.trim(), autonomy, testsAt, ...roles };
    // Runs on one of your computers (BLG-788): the plan is made there and opens at once; held, the sheet stays.
    const sent = sendToComputer(startDeps, project, roles.agent?.runtime ?? myRuntime(prefsNow()), { kind: 'plan', input });
    if (sent === 'held') return;
    close();
    if (sent === 'sent') return;
    await act(() => api.create({ projectId: project, ...input }));
  };

  // In the app on a Mac, the Mac's own sheet (lib/native-sheet.ts): the same state, the system's controls.
  const agents = useAgentEntries();
  const runs = useRunsOn(project);
  const runtime = useApp((s) => myRuntime(s.prefs));
  const here = upFirst(thisComputer());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const planIn = projects.find((x) => x.id === project)?.name;
  const native = useNativeSheet(
    nativeSheets(),
    !projects.length
      ? { title: 'New Plan', intro: 'Plans belong to a project: a folder with your code. Add one first.', rows: [], submit: 'Add a Project…', canSubmit: true }
      : {
          title: planIn ? `Plan in ${planIn}` : 'New Plan',
          intro: 'Say what you want built. Your agent reads the code and cuts it into milestones and tasks; you talk it through, and nothing reaches the board until you approve.',
          width: 600,
          rows: [
            { kind: 'textarea', id: 'goal', value: goal, lines: 6, focus: true },
            // As the web sheet's line, whose shortcut splits it in two.
            { kind: 'note', text: `${t('What it’s for and what done looks like.')} ${chordLabel('Cmd+Enter')} ${t('starts planning.')}` },
            ...(known ? [] : [{ kind: 'popup' as const, id: 'project', label: 'Project', value: project, options: projects.map((x) => ({ value: x.id, label: x.name })) }]),
            ...(runs.machines.length
              ? [
                  {
                    kind: 'popup' as const,
                    id: 'runs',
                    label: 'Runs on',
                    value: runs.value,
                    options: runsOnRows(runs.machines, runtime, here).map((row) => ({
                      value: row.value,
                      label: row.label,
                      hint: row.line,
                      ...(row.machine ? { mark: <MachineMark machine={row.machine} size={13} /> } : { icon: row.value === HERE ? ('laptop' as const) : ('gauge' as const) }),
                      ...(row.disabled ? { disabled: true } : {}),
                    })),
                  },
                ]
              : []),
            // The three cards, as plans/PlanSheets.tsx's AutonomyCards draws them.
            { kind: 'cards', id: 'autonomy', label: 'How it runs', value: autonomy, options: AUTONOMIES.map((a) => ({ value: a, label: AUTONOMY_INFO[a].label, icon: AUTONOMY_ICON[a], hint: AUTONOMY_INFO[a].summary })) },
            { kind: 'popup', id: 'tests', label: 'When to run tests', value: testsAt, hint: `${t(TESTS_AT_INFO[testsAt].hint)}.`, options: TESTS_AT.map((x) => ({ value: x, label: TESTS_AT_INFO[x].label })) },
            { kind: 'disclosure', id: 'more', label: 'More options', open: more },
            ...(more
              ? [
                  ...PLAN_ROLES.map((role) => ({ kind: 'popup' as const, id: `role:${role}`, label: ROLE_INFO[role].label, value: picks[role], options: choicesOf(roleEntries(role, tiers, agents)) })),
                  { kind: 'note' as const, text: 'The strongest model designs it and takes over what’s hard (fix tasks after a failed check, conflicts, a task that stopped twice), an everyday one writes the code, one in between checks it. Change any of them later in Plan Settings.' },
                ]
              : []),
          ],
          submit: 'Plan with Your Agent',
          canSubmit: Boolean(goal.trim() && project),
          busy,
          ...(problem ? { error: problem } : {}),
        },
    {
      change: (id, value) => {
        if (id === 'goal') setGoal(value);
        else if (id === 'project') setProject(value);
        else if (id === 'runs') runs.set(value as RunsOn);
        else if (id === 'autonomy') setAutonomy(value as Autonomy);
        else if (id === 'tests') setTestsAt(value as TestsAt);
        else if (id === 'more') setMore(value === 'true');
        else if (id.startsWith('role:')) setPicked((was) => ({ ...was, [id.slice(5)]: value }));
      },
      submit: () => {
        if (!projects.length) return addProject();
        if (!goal.trim() || !project || busy) return;
        setBusy(true);
        setProblem(undefined);
        create()
          .catch((err: unknown) => setProblem(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false));
      },
      cancel: close,
    },
  );
  if (native) return null;
  if (!projects.length) {
    return <FormSheet title="New Plan" intro="Plans belong to a project: a folder with your code. Add one first." submitLabel="Add a Project…" onSubmit={addProject} onCancel={close} />;
  }
  const name = projects.find((p) => p.id === project)?.name;
  return (
    <FormSheet
      title={name ? `Plan in ${name}` : 'New Plan'}
      icon="flag"
      intro="Say what you want built. Your agent reads the code and cuts it into milestones and tasks; you talk it through, and nothing reaches the board until you approve."
      submitLabel="Plan with Your Agent"
      width={600}
      canSubmit={Boolean(goal.trim() && project)}
      onCancel={close}
      onSubmit={create}
    >
      <div className={p.newPlan}>
        <label className={p.newPlanLabel} htmlFor="plan-goal">
          Goal
        </label>
        <GoalBox value={goal} onChange={setGoal} />
        <div className={p.newPlanHint}>What it’s for and what done looks like. {chordLabel('Cmd+Enter')} starts planning.</div>
        {known ? null : (
          <div className={p.newPlanRow}>
            <span className={p.newPlanLabel}>Project</span>
            <Popup label="Project" value={project} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={setProject} />
          </div>
        )}
        {/* Where it runs (BLG-786): the plan and its worktrees. Only with a computer paired. */}
        <RunsOnRow project={project} className={p.newPlanRow} labelClassName={p.newPlanLabel} />
        <div className={p.newPlanLabel} id="plan-runs">
          How it runs
        </div>
        <AutonomyCards value={autonomy} onChange={setAutonomy} />
        <div className={p.newPlanRow}>
          <span className={p.newPlanLabel}>When to run tests</span>
          <Popup label="When to run tests" value={testsAt} options={TESTS_AT.map((t) => ({ value: t, label: TESTS_AT_INFO[t].label }))} onChange={setTestsAt} />
        </div>
        <div className={p.newPlanHint}>{TESTS_AT_INFO[testsAt].hint}.</div>
        <button type="button" className={p.newPlanMore} aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon name={more ? 'chevronDown' : 'chevronRight'} size={10} />
          More options
        </button>
        {more ? (
          <>
            <PlanRoles tiers={tiers} picks={picks} onPick={(role, v) => setPicked((was) => ({ ...was, [role]: v }))} reveal />
            <div className={p.newPlanHint}>The strongest model designs it and takes over what’s hard (fix tasks after a failed check, conflicts, a task that stopped twice), an everyday one writes the code, one in between checks it. Change any of them later in Plan Settings.</div>
            <div className={p.newPlanHint}>A task whose model fails, or that stops twice, first goes up the steps in Settings › Auto Route › When a Model Fails.</div>
          </>
        ) : null}
      </div>
    </FormSheet>
  );
}
