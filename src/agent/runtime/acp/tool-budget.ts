import { z } from 'zod';
import type { ToolSuite } from '../../tool-kit.js';

/**
 * Some agents take only so much of a client's tools. Antigravity keeps about 45 KB of tool
 * definitions in all (theirs and yours) and, past it, leaves out the larger ones of what came in the
 * middle: they're still listed by name, and a call to one fails with "tool … is not enabled for
 * server …". With a plan's own conversation carrying every Beluga suite (some 120 KB), plan_update
 * and plan_write went first, and the plan couldn't be changed.
 *
 * So for such an agent (AcpExtension.toolBudget) a run's suites are fitted to it: what the run is
 * for first (its task, its plan, its board, a Sentinel's own tools in its run), never left out;
 * then Beluga's other suites, most useful first, as long as they fit. What's left out is said in
 * the conversation, so nothing goes missing silently.
 */

/** Beluga's suites, most useful first: the ones further down go first when they don't fit. */
const ORDER = ['beluga_task', 'beluga_plan', 'beluga_board', 'beluga_sentinel', 'beluga', 'beluga_view', 'beluga_chats', 'beluga_threads', 'beluga_mcp', 'beluga_calls', 'beluga_mac', 'beluga_phone', 'beluga_dashboard'];

const sizes = new Map<string, number>();

/** One suite's tool definitions, in bytes of JSON (name, description, input schema), as an agent reads them. */
export function suiteSize(suite: ToolSuite): number {
  let total = 0;
  for (const t of suite.tools) {
    const key = `${suite.name}/${t.name}`;
    let size = sizes.get(key);
    if (size === undefined) {
      try {
        size = JSON.stringify({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(z.object(t.inputSchema)) }).length;
      } catch {
        size = t.description.length + 200;
      }
      sizes.set(key, size);
    }
    total += size;
  }
  return total;
}

/** The suites a run keeps within `budget`, in the order to offer them; and the ones left out. `essential` are always kept, first. */
export function fitToolBudget(suites: Readonly<Record<string, ToolSuite>>, budget: number, essential: ReadonlySet<string>): { readonly suites: Record<string, ToolSuite>; readonly left: readonly string[] } {
  const rank = (name: string): number => {
    const i = ORDER.indexOf(name);
    return i < 0 ? ORDER.length : i;
  };
  const names = Object.keys(suites).sort((a, b) => Number(essential.has(b)) - Number(essential.has(a)) || rank(a) - rank(b));
  const kept: Record<string, ToolSuite> = {};
  const left: string[] = [];
  let used = 0;
  for (const name of names) {
    const size = suiteSize(suites[name]!);
    if (essential.has(name) || used + size <= budget) {
      kept[name] = suites[name]!;
      used += size;
    } else left.push(name);
  }
  return { suites: kept, left };
}

/** What the run says when some of Beluga's tools were left out. */
export function leftOutNote(agent: string, left: readonly string[]): string {
  const names = left.map((n) => n.replace(/^beluga_?/, '') || 'room');
  return `${agent} takes only so many tools: Beluga left out its ${names.join(', ')} tools for this run`;
}
