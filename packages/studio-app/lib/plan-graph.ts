import type { StudioMilestone, StudioPlanView, StudioTask } from '../../../src/studio/protocol';
import type { MapItem, OutlineMilestone, OutlineTask, PlanTone } from '../../ui-plan';
import { t, type Lang, type StringKey } from './strings';

/** The customer app's status word for a milestone, from strings.ts. */
export const milestoneStatusKey = (status: StudioMilestone['status']): StringKey => `status.${status}` as StringKey;

/** The pastel a milestone status is drawn in (docs/studio-plan-page.md §4.4). */
export function milestoneTone(status: StudioMilestone['status']): PlanTone {
  switch (status) {
    case 'planned':
    case 'waiting':
      return 'plain';
    case 'working':
      return 'sky';
    case 'checking':
      return 'lavender';
    case 'review':
      return 'butter';
    case 'passed':
      return 'mint';
  }
}

/** The milestone the plan is on: the first one at work, being checked, or waiting for review. */
export function currentMilestone(view: StudioPlanView): StudioMilestone | undefined {
  return view.milestones.find((m) => m.status === 'working' || m.status === 'checking' || m.status === 'review');
}

const doneTasks = (m: StudioMilestone): number => m.tasks.filter((task) => task.status === 'done').length;

/** A task's status in the milestone vocabulary (their words are the ones strings.ts has). */
const taskStatus = (status: StudioTask['status']): StudioMilestone['status'] =>
  status === 'doing' ? 'working' : status === 'done' ? 'passed' : status;

/** The map's items: one per milestone, in plan order; the studio app sends no dependsOn (one chain). */
export function mapItems(view: StudioPlanView, lang: Lang): MapItem[] {
  const current = currentMilestone(view)?.ref;
  return view.milestones.map((m, i) => ({
    id: m.ref,
    title: m.title,
    index: i + 1,
    tone: milestoneTone(m.status),
    statusLabel: t(lang, milestoneStatusKey(m.status)),
    done: doneTasks(m),
    total: m.tasks.length,
    emphasized: m.ref === current,
    passed: m.status === 'passed',
  }));
}

/** The outline's rows, with the same status words and tones as the map. */
export function outlineOf(view: StudioPlanView, lang: Lang): OutlineMilestone[] {
  return view.milestones.map((m, i) => {
    const tasks: OutlineTask[] = m.tasks.map((task) => {
      const status = taskStatus(task.status);
      return {
        id: task.ref,
        title: task.title,
        tone: milestoneTone(status),
        statusLabel: t(lang, milestoneStatusKey(status)),
        ...(task.goal ? { goal: task.goal } : {}),
        ...(task.acceptance.length ? { acceptance: task.acceptance } : {}),
      };
    });
    return {
      id: m.ref,
      title: m.title,
      index: i + 1,
      tone: milestoneTone(m.status),
      statusLabel: t(lang, milestoneStatusKey(m.status)),
      done: doneTasks(m),
      total: m.tasks.length,
      passed: m.status === 'passed',
      criteria: m.criteria,
      tasks,
    };
  });
}
