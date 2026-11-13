import type { MilestoneRolesView, RoleSeenView } from '../../../../src/fork/companion/plan-roles-view';
import { autoAgentName } from '../../../../src/shared/auto-route';

/**
 * Fork (1.55, BLG-201): a milestone's “Who did it” on the phone's plan page, in words, read only:
 * the same answer as the Mac's (src/fork/plans/roles.ts, sent as `roles`). English, like the rest
 * of the phone for now. Nothing from a Mac before 1.55 (`supported` false) or with no roles.
 */

export interface RoleRow {
  readonly key: 'arch' | 'work' | 'check' | 'fix';
  readonly label: string;
  /** The model that did it, else what's set (with `note`); none: Not set. */
  readonly model?: string;
  /** Its runtime, for its mark. */
  readonly runtime?: string;
  readonly note?: string;
  /** What ran isn't what's set: “Set to Opus: why”. */
  readonly differs?: string;
  /** Hard fixes: each handoff, “A task that stopped twice → Claude (Sonnet)”. */
  readonly handoffs: readonly string[];
}

const LABEL = { arch: 'Architecture', work: 'Coding', check: 'Audit', fix: 'Hard fixes' } as const;

const WHY: Record<string, string> = {
  pick: 'picked with Start with…',
  task: 'its task has an agent of its own',
  fix: 'its check failed: the fix agent took over',
  default: 'nothing set runs here: your default agent',
  changed: 'the plan’s setting changed after it started',
};

const HANDED: Record<string, string> = { fix: 'The fix tasks', stopped: 'A task that stopped twice', stuck: 'A stuck conversation', conflict: 'The conflict' };

const nameOf = (a: RoleSeenView['agent']): string => (a ? autoAgentName({ runtime: a.runtime, label: a.label, ...(a.model ? { model: a.model } : {}) }) : 'Your default agent');
const setWords = (r: RoleSeenView): string => (r.set ? nameOf(r.set) : r.auto ? 'Auto route' : 'Your default agent');

function row(key: RoleRow['key'], r: RoleSeenView): RoleRow {
  const handoffs = (r.handoffs ?? []).map((h) => `${HANDED[h.what] ?? 'Something hard'} → ${h.to}`);
  const base = { key, label: LABEL[key], handoffs };
  if (r.state === 'off') return { ...base, note: 'Not set' };
  if (r.state === 'on') {
    const agent = r.agent;
    // Hard fixes taken over by another than what's set now: who took over, by the last handoff.
    const model = key === 'fix' && !agent && r.handoffs?.length ? r.handoffs.at(-1)!.to : nameOf(agent);
    return { ...base, model, ...(agent ? { runtime: agent.runtime } : {}), ...(r.now ? { note: `Handed over, now on ${nameOf(r.now)}` } : {}), ...(r.why ? { differs: `Set to ${setWords(r)}: ${WHY[r.why] ?? r.why}` } : {}) };
  }
  const note = r.state === 'skipped' ? 'Started without a design' : key === 'fix' ? 'Nothing handed over yet' : 'Not started yet';
  return { ...base, model: setWords(r), ...(r.set ? { runtime: r.set.runtime } : {}), note };
}

export function roleRows(roles: MilestoneRolesView | undefined, supported: boolean): RoleRow[] {
  if (!supported || !roles) return [];
  return (['arch', 'work', 'check', 'fix'] as const).map((k) => row(k, roles[k]));
}
