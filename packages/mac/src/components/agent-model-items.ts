import { type AgentRef, CLAUDE_AGENT } from '../../../../src/protocol.js';
import type { RuntimeChoice, RuntimeModel } from '../../../../src/shared/agent-runtimes.js';
import { type AgentMark, runtimeMark } from '../../../../src/shared/agent-marks.js';

/**
 * One row of an agent menu: the fields of SpecMenu's ActionItem these rows use (an ActionItem as
 * it is), kept here so this module loads without the app's path aliases (tests import it from the root).
 */
export interface AgentMenuRow {
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly icon?: AgentMark;
  readonly separate?: boolean;
  readonly checked?: boolean;
  readonly submenu?: readonly AgentMenuRow[];
  readonly onSelect: () => void;
}

/**
 * Who does a part of the work (Build With ▸, a plan's Planner ▸), one row per agent with its mark
 * (Claude, Codex, OpenCode…), each a submenu of its models: "Default Model" first (the agent runs
 * whatever it defaults to), then every model it offers here. An agent with no models to pick is a
 * plain row; one not set up here, or a model that can't be picked now, is greyed, saying why.
 * `current` is checked (its agent's row too); `pick` gets the agent, with its model when one was picked.
 */
export function agentModelItems(runtimes: readonly RuntimeChoice[], claudeModels: readonly RuntimeModel[], current: AgentRef | undefined, pick: (agent: AgentRef) => void): AgentMenuRow[] {
  const known = runtimes.length ? runtimes : [{ id: CLAUDE_AGENT.runtime, label: CLAUDE_AGENT.label, available: true }];
  return known.map((r): AgentMenuRow => {
    const row = { label: r.label, icon: runtimeMark(r.id), checked: current?.runtime === r.id };
    if (!r.available) return { ...row, disabled: true, ...(r.why ? { hint: r.why } : {}), onSelect: () => undefined };
    const agent = { runtime: r.id, label: r.label };
    const models = (r.id === CLAUDE_AGENT.runtime ? claudeModels : (r.models ?? [])).filter((m) => m.value);
    if (!models.length) return { ...row, onSelect: () => pick(agent) };
    const mine = row.checked ? current?.model : undefined;
    const now = mine ? models.find((m) => m.value === mine)?.label ?? mine : undefined;
    return {
      ...row,
      ...(row.checked ? { hint: now ?? 'Default model' } : {}),
      submenu: [
        { label: 'Default Model', hint: `Whatever ${r.label} defaults to`, checked: row.checked && !mine, onSelect: () => pick(agent) },
        ...models.map((m, i): AgentMenuRow => ({
          label: m.label,
          ...(m.why ? { disabled: true, hint: m.why } : {}),
          ...(i === 0 ? { separate: true } : {}),
          checked: mine === m.value,
          onSelect: () => pick({ ...agent, model: m.value }),
        })),
      ],
      onSelect: () => undefined,
    };
  });
}
