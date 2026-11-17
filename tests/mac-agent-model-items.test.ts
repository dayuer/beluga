import { describe, expect, it } from 'vitest';
import type { AgentRef } from '../src/protocol.js';
import type { RuntimeChoice, RuntimeModel } from '../src/shared/agent-runtimes.js';
import { agentModelItems } from '../packages/mac/src/components/agent-model-items.js';

const model = (value: string, label: string, why?: string): RuntimeModel => ({ value, label, description: '', ...(why ? { why } : {}) });
const runtimes: RuntimeChoice[] = [
  { id: 'claude', label: 'Claude', available: true },
  { id: 'codex', label: 'Codex', available: true, models: [model('gpt-5', 'GPT-5'), model('o3', 'o3', 'Not on your plan')] },
  { id: 'opencode', label: 'OpenCode', available: true },
  { id: 'copilot', label: 'Copilot', available: false, why: 'Install Copilot' },
];
const claude = [model('', 'Default'), model('opus', 'Opus'), model('sonnet', 'Sonnet')];

describe('agentModelItems: each agent with its models under it', () => {
  it('gives an agent with models a submenu: Default Model, then its models', () => {
    const rows = agentModelItems(runtimes, claude, undefined, () => undefined);
    expect(rows.map((r) => r.label)).toEqual(['Claude', 'Codex', 'OpenCode', 'Copilot']);
    expect(rows[0]!.submenu?.map((r) => r.label)).toEqual(['Default Model', 'Opus', 'Sonnet']);
    expect(rows[1]!.submenu?.map((r) => r.label)).toEqual(['Default Model', 'GPT-5', 'o3']);
    expect(rows[1]!.submenu?.[2]).toMatchObject({ disabled: true, hint: 'Not on your plan' });
    expect(rows[2]!.submenu).toBeUndefined();
    expect(rows[3]).toMatchObject({ disabled: true, hint: 'Install Copilot' });
  });

  it('picks the agent with the model, or without one for Default Model', () => {
    const got: AgentRef[] = [];
    const rows = agentModelItems(runtimes, claude, undefined, (a) => got.push(a));
    rows[0]!.submenu![1]!.onSelect();
    rows[1]!.submenu![0]!.onSelect();
    rows[2]!.onSelect();
    expect(got).toEqual([{ runtime: 'claude', label: 'Claude', model: 'opus' }, { runtime: 'codex', label: 'Codex' }, { runtime: 'opencode', label: 'OpenCode' }]);
  });

  it('checks the agent in use and its model', () => {
    const rows = agentModelItems(runtimes, claude, { runtime: 'claude', label: 'Claude', model: 'sonnet' }, () => undefined);
    expect(rows[0]).toMatchObject({ checked: true, hint: 'Sonnet' });
    expect(rows[0]!.submenu!.filter((r) => r.checked).map((r) => r.label)).toEqual(['Sonnet']);
    expect(rows[1]!.checked).toBe(false);
    const plain = agentModelItems(runtimes, claude, { runtime: 'codex', label: 'Codex' }, () => undefined);
    expect(plain[1]!.submenu!.filter((r) => r.checked).map((r) => r.label)).toEqual(['Default Model']);
  });
});
