import type { AgentRef } from '../../protocol.js';
import type { RuntimeChoice } from '../../shared/agent-runtimes.js';
import { type AutoRoute, type RouteList, candidateRuns, parseChoice, tierList } from '../../shared/auto-route.js';

/**
 * Fork: a plan's task stopped by a usage limit goes to the next model of the same auto route list
 * (Settings › Auto Route), instead of waiting for the limit to reset. The same tier, so no dearer
 * and no weaker: GLM at its limit hands over to DeepSeek, not up to Opus. Pure: the fixer
 * (fixer.ts sidestep) does the switch, tests/fork-limit-next-model.test.ts holds the rules.
 */

/** The lists a task's model can be on, in the order they're looked through. */
const TIERS: readonly RouteList[] = ['build', 'hard', 'review'];

/** An agent as a list's candidate value (`runtime:model`). */
export const choiceOf = (a: AgentRef): string => `${a.runtime}:${a.model ?? ''}`;

/** Whether two candidates share one usage limit: one runtime, and for local models one endpoint. */
export function sameLimit(a: string, b: string): boolean {
  const x = parseChoice(a);
  const y = parseChoice(b);
  if (!x || !y || x.runtime !== y.runtime) return false;
  return x.runtime !== 'local' || x.model.split('/')[0] === y.model.split('/')[0];
}

/** The list an agent is on (the first that names it); undefined: on none of them. */
export function tierOf(agent: AgentRef, route: AutoRoute | undefined): RouteList | undefined {
  const value = choiceOf(agent);
  return TIERS.find((t) => tierList(t, route).includes(value));
}

/**
 * Who takes over from a model at its usage limit: the next of its own list that runs here, isn't at
 * a limit itself (`limited`) and doesn't share the limit that was hit (another model of the same
 * endpoint, or of the same sign-in, would be refused too). Those after it first, then those before.
 * Undefined: it's on no list, or nothing else of its list can take it (it waits for the reset, as before).
 */
export function nextOfTier(agent: AgentRef, route: AutoRoute | undefined, runtimes: readonly RuntimeChoice[], limited: (value: string) => boolean = () => false): AgentRef | undefined {
  const tier = tierOf(agent, route);
  if (!tier) return undefined;
  const list = tierList(tier, route);
  const value = choiceOf(agent);
  const at = list.indexOf(value);
  for (const next of [...list.slice(at + 1), ...list.slice(0, at)]) {
    if (next === value || sameLimit(next, value) || limited(next) || !candidateRuns(runtimes, next)) continue;
    const c = parseChoice(next)!;
    const label = runtimes.find((r) => r.id === c.runtime)?.label ?? c.runtime;
    return { runtime: c.runtime, label, ...(c.model ? { model: c.model } : {}) };
  }
  return undefined;
}
