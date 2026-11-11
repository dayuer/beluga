import type { AgentRef } from '../../../../src/protocol.js';
import type { PlanRoleDefaults } from '../../../../src/shared/auto-route.js';
import { agentName } from '../../../../src/shared/agent-label.js';

/**
 * Who does each part of a new plan (New Plan › More options): the strongest model designs it and
 * takes over what's hard, an everyday one writes the code, one between checks it (the tiers:
 * shared/auto-route.ts, planRoleDefaults). Each role's pop-up starts on its tier's model, and you
 * can pick any agent instead. Pure: tests/plan-roles.test.ts.
 */
export type PlanRole = 'arch' | 'work' | 'check' | 'fix';

export const PLAN_ROLES: readonly PlanRole[] = ['arch', 'work', 'check', 'fix'];

/** The pop-up value for "as the tiers say". */
export const BY_TIER = '@tier';
/** The pop-up value for "no architect step". */
export const NO_ARCHITECT = '@none';
/** The pop-up value for "as before": your agent (work), the work's agent (checks), whoever is at it (hard fixes). */
export const AS_BEFORE = '';

export const ROLE_INFO: Record<PlanRole, { readonly label: string; readonly asBefore: string }> = {
  arch: { label: 'Architecture', asBefore: 'No architect (start right away)' },
  work: { label: 'Coding', asBefore: 'Your agent' },
  check: { label: 'Audit', asBefore: 'Same as its work' },
  fix: { label: 'Hard fixes', asBefore: 'Whoever is at it' },
};

/** A role's tier pick, in words ("Strongest: Claude (Opus)"); undefined: nothing of its tier runs here. */
export function tierLabel(role: PlanRole, d: PlanRoleDefaults): string | undefined {
  const name = (a: AgentRef | undefined): string | undefined => (a ? agentName(a, { model: true }) : undefined);
  switch (role) {
    case 'arch':
      return d.arch ? `Strongest: ${name(d.arch)}` : undefined;
    case 'fix':
      return d.fix ? `Strongest: ${name(d.fix)}` : undefined;
    case 'check':
      return d.check ? `Mid-tier: ${name(d.check)}` : undefined;
    case 'work':
      return d.work === 'auto' ? 'Auto route: an everyday model per task' : d.work ? `Everyday: ${name(d.work)}` : undefined;
  }
}

/** The agent a role's tier pick is (undefined for work on auto route: each task is routed as it starts). */
function tierAgent(role: PlanRole, d: PlanRoleDefaults): AgentRef | undefined {
  const a = role === 'arch' ? d.arch : role === 'fix' ? d.fix : role === 'check' ? d.check : d.work;
  return a === 'auto' ? undefined : a;
}

/** Where a role's pop-up starts: its tier's model, else as before (no architect, for the architecture). */
export function roleStart(role: PlanRole, d: PlanRoleDefaults): string {
  if (tierLabel(role, d)) return BY_TIER;
  return role === 'arch' ? NO_ARCHITECT : AS_BEFORE;
}

/** The plan's roles for plans.create, from each pop-up's value (`forChoice`: a `runtime:model` value as an agent). */
export function rolesInput(picks: Readonly<Record<PlanRole, string>>, d: PlanRoleDefaults, forChoice: (value: string) => AgentRef): { agent?: AgentRef; archAgent?: AgentRef; checkAgent?: AgentRef; fixAgent?: AgentRef } {
  const pick = (role: PlanRole): AgentRef | undefined => {
    const v = picks[role];
    if (v === BY_TIER) return tierAgent(role, d);
    if (v === AS_BEFORE || v === NO_ARCHITECT) return undefined;
    return forChoice(v);
  };
  const agent = pick('work');
  const archAgent = pick('arch');
  const checkAgent = pick('check');
  const fixAgent = pick('fix');
  return { ...(agent ? { agent } : {}), ...(archAgent ? { archAgent } : {}), ...(checkAgent ? { checkAgent } : {}), ...(fixAgent ? { fixAgent } : {}) };
}
