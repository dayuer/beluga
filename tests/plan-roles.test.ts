import { describe, expect, it } from 'vitest';
import { AS_BEFORE, BY_TIER, NO_ARCHITECT, PLAN_ROLES, roleStart, rolesInput, tierLabel } from '../packages/mac/src/plans/plan-roles-model.js';
import type { PlanRoleDefaults } from '../src/shared/auto-route.js';
import type { AgentRef } from '../src/protocol.js';

/** New Plan › More options (fork): a pop-up per role, each starting on its tier's model. */

const OPUS: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };
const SONNET: AgentRef = { runtime: 'claude', label: 'Claude', model: 'sonnet' };
const HAIKU: AgentRef = { runtime: 'claude', label: 'Claude', model: 'haiku' };
const CODEX: AgentRef = { runtime: 'codex', label: 'Codex' };
const TIERS: PlanRoleDefaults = { arch: OPUS, fix: OPUS, work: HAIKU, check: SONNET };
const forChoice = (v: string): AgentRef => (v === 'codex:' ? CODEX : { runtime: 'x', label: v });

describe('a new plan’s roles', () => {
  it('each starts on its tier, said with its tier and model', () => {
    expect(PLAN_ROLES.map((r) => roleStart(r, TIERS))).toEqual([BY_TIER, BY_TIER, BY_TIER, BY_TIER]);
    expect(PLAN_ROLES.map((r) => tierLabel(r, TIERS))).toEqual(['Strongest: Claude (Opus)', 'Everyday: Claude (Haiku)', 'Mid-tier: Claude (Sonnet)', 'Strongest: Claude (Opus)']);
    expect(tierLabel('work', { ...TIERS, work: 'auto' })).toBe('Auto route: an everyday model per task');
  });

  it('as the tiers say, every role is set (work on auto route: left to each task)', () => {
    const picks = { arch: BY_TIER, work: BY_TIER, check: BY_TIER, fix: BY_TIER };
    expect(rolesInput(picks, TIERS, forChoice)).toEqual({ agent: HAIKU, archAgent: OPUS, checkAgent: SONNET, fixAgent: OPUS });
    expect(rolesInput(picks, { ...TIERS, work: 'auto' }, forChoice)).toEqual({ archAgent: OPUS, checkAgent: SONNET, fixAgent: OPUS });
  });

  it('nothing of a tier runs here: that role as before (no architect, your agent, the work’s agent, whoever is at it)', () => {
    expect(PLAN_ROLES.map((r) => roleStart(r, {}))).toEqual([NO_ARCHITECT, AS_BEFORE, AS_BEFORE, AS_BEFORE]);
    expect(rolesInput({ arch: NO_ARCHITECT, work: AS_BEFORE, check: AS_BEFORE, fix: AS_BEFORE }, {}, forChoice)).toEqual({});
  });

  it('an agent you pick wins over its tier', () => {
    expect(rolesInput({ arch: BY_TIER, work: 'codex:', check: BY_TIER, fix: NO_ARCHITECT }, TIERS, forChoice)).toEqual({ agent: CODEX, archAgent: OPUS, checkAgent: SONNET });
  });
});
