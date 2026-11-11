import { useMemo, useState } from 'react';
import { type Autonomy, TESTS_AT, TESTS_AT_INFO, type TestsAt } from '@beluga/core/plans/model.js';
import { agentForChoice } from '@beluga/ui/agent-choice.js';
import { planRoleDefaults } from '@beluga/shared/auto-route.js';
import { useDefaultAutonomy } from '../../plans/use-default-autonomy.js';
import { PLAN_ROLES, type PlanRole, roleStart, rolesInput } from '../../plans/plan-roles-model.js';
import { PlanRoles } from '../../plans/PlanRoles.js';
import { AutonomyCards, GoalBox } from '../../plans/PlanSheets.js';
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
  if (!projects.length) {
    // The sidebar's own "Add a Project…", one click away (every OS has it; not every one has a File menu).
    const addProject = (): void => {
      close();
      actions.run({ type: 'add_project' });
    };
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
      onSubmit={async () => {
        const roles = rolesInput(picks, tiers, (v) => agentForChoice(v, runtimes));
        const input = { goal: goal.trim(), autonomy, testsAt, ...roles };
        // Runs on one of your computers (BLG-788): the plan is made there and opens at once; held, the sheet stays.
        const sent = sendToComputer(startDeps, project, roles.agent?.runtime ?? myRuntime(prefsNow()), { kind: 'plan', input });
        if (sent === 'held') return;
        close();
        if (sent === 'sent') return;
        await act(() => api.create({ projectId: project, ...input }));
      }}
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
          </>
        ) : null}
      </div>
    </FormSheet>
  );
}
