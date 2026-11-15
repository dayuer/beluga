import type { AgentRef } from '../../protocol.js';
import type { RuntimeChoice } from '../../shared/agent-runtimes.js';
import { type AutoRoute, candidateRuns, parseChoice, tierList } from '../../shared/auto-route.js';

/**
 * Fork: the ladder a plan's task climbs when its model fails (Settings › Auto Route › When a Model
 * Fails). A model that errors (the endpoint says the model isn't there, the key is wrong, it can't
 * sign in) goes up one rung at once instead of being woken on the same model; a task that stops twice
 * goes up one rung too, and again each time it stops after that, until the top: then it waits for
 * you. An empty ladder is the old way: one go on the plan's fix agent. Fix tasks after a failed check
 * and conflicts still go to the fix agent (fixer.ts).
 */

/** Claude's own models by family, weakest first: an alias (`opus`) and a full id (`claude-opus-5-5`) are one rung. */
const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable', 'mythos'] as const;
const FAMILY = new RegExp(`\\b(${FAMILIES.join('|')})\\b`, 'i');

const familyOf = (a: AgentRef): string | undefined => (a.runtime === 'claude' ? FAMILY.exec((a.model ?? '').replace(/-/g, ' '))?.[1]?.toLowerCase() : undefined);

/** How strong a Claude model is (its family's place); undefined: not Claude, or no family it names. */
const claudeRank = (a: AgentRef): number | undefined => {
  const fam = familyOf(a);
  return fam ? FAMILIES.indexOf(fam as (typeof FAMILIES)[number]) : undefined;
};

/** One rung's identity: Claude's by family, any other runtime's by its exact model. */
function rungKey(a: AgentRef | undefined): string | undefined {
  if (!a) return undefined;
  if (a.runtime === 'claude') return `claude:${familyOf(a) ?? a.model ?? ''}`;
  return `${a.runtime}:${a.model ?? ''}`;
}

/** The ladder's rungs that run on this Mac now, in order, as agents. */
export function ladderAgents(route: AutoRoute | undefined, runtimes: readonly RuntimeChoice[]): AgentRef[] {
  return tierList('ladder', route).flatMap((value) => {
    const c = parseChoice(value);
    if (!c || !candidateRuns(runtimes, value)) return [];
    const label = runtimes.find((r) => r.id === c.runtime)?.label ?? c.runtime;
    return [{ runtime: c.runtime, label, ...(c.model ? { model: c.model } : {}) }];
  });
}

/**
 * The rung above the one a task is on. Claude with no model of its own runs on your default
 * (`defaultModel`, Settings' model). A model of another runtime that isn't on the ladder (a local
 * model you picked for the plan's work, say) counts as below them all: its next is the first rung.
 * A Claude model that isn't on it goes to the first Claude rung stronger than it, never down; one
 * whose strength isn't known (no family it names) stays. Undefined: it stays (the top already, an
 * empty ladder, nothing stronger, or not known).
 */
export function nextRung(ladder: readonly AgentRef[], current: AgentRef | undefined, defaultModel?: string): AgentRef | undefined {
  const cur = current?.runtime === 'claude' && !current.model && defaultModel ? { ...current, model: defaultModel } : current;
  const key = rungKey(cur);
  const at = ladder.findIndex((r) => rungKey(r) === key);
  if (at >= 0) return ladder[at + 1];
  if (cur?.runtime !== 'claude') return ladder[0];
  const rank = claudeRank(cur);
  if (rank === undefined) return undefined;
  return ladder.find((r) => (claudeRank(r) ?? -1) > rank);
}

/**
 * Whether a run stopped because its model failed, by the watchdog's reason (shared/run-failure.ts
 * failureTitle): the API refused it (no such model, a wrong key, a bad request) or it couldn't sign
 * in. Not a usage limit (it resumes by itself), not a lost connection or an overloaded API (they pass).
 */
export function modelFailed(stall: string | undefined): boolean {
  if (!stall) return false;
  if (/usage limit|overloaded|rate.?limit|\b529\b|lost its connection/i.test(stall)) return false;
  return /API failed:|isn[’']t signed in|sign-in on .* expired|couldn[’']t sign in/i.test(stall);
}
