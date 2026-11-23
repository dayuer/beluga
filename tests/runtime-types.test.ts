import { describe, expect, it } from 'vitest';
import { type RuntimeCapabilities, safetyFor } from '../src/agent/runtime/types.js';

const gated: RuntimeCapabilities = {
  canGateEveryTool: true,
  hasSandbox: false,
  canSteer: true,
  canInterrupt: true,
  hasPlanMode: true,
  hasSubagents: true,
  hasBackgroundAgents: true,
  hasUsage: true,
  canResume: true,
  canFork: true,
  canAskUser: true,
  hasCompaction: true,
  hasModelList: true,
  hasProcess: true,
  skills: 'native',
  promptImages: true,
  toolMounts: ['in-process', 'stdio'],
};
const ungated: RuntimeCapabilities = { ...gated, canGateEveryTool: false, toolMounts: ['stdio'] };

describe('safetyFor', () => {
  it('trusts policy.ts only when every tool is gated', () => {
    expect(safetyFor(gated, { vetTool: () => undefined, guest: true })).toEqual({ kind: 'gated' });
  });

  it('demands a sandbox when the runtime cannot gate each tool', () => {
    expect(safetyFor(ungated)).toEqual({ kind: 'sandbox' });
    expect(safetyFor(ungated, {})).toEqual({ kind: 'sandbox' });
  });

  it("refuses a friend's task or a guest without per-tool gating", () => {
    expect(safetyFor(ungated, { vetTool: () => undefined }).kind).toBe('sandbox');
    expect(safetyFor(ungated, { vetTool: () => undefined })).toHaveProperty('refuse');
    expect(safetyFor(ungated, { guest: true })).toHaveProperty('refuse');
  });

  it("takes a friend's task when its own sandbox confines every step, never a guest", () => {
    const sandboxed = { ...ungated, hasSandbox: true };
    expect(safetyFor(sandboxed, { vetTool: () => undefined })).toEqual({ kind: 'sandbox' });
    expect(safetyFor(sandboxed, { guest: true })).toHaveProperty('refuse');
  });

  it("refuses an external agent's run below Full trust without gating or a sandbox (it reads your home unasked)", () => {
    const external = { asOwner: true, vetTool: () => undefined } as const;
    expect(safetyFor(ungated, { ...external, scope: 'folder' })).toMatchObject({ kind: 'sandbox', refuse: expect.stringContaining('Full trust') });
    // At Full it is you, on another screen.
    expect(safetyFor(ungated, { ...external, scope: 'full' })).toEqual({ kind: 'sandbox' });
    // Codex's sandbox holds it in its folders, and Claude gates each step.
    expect(safetyFor({ ...ungated, hasSandbox: true }, { ...external, scope: 'folder' })).toEqual({ kind: 'sandbox' });
    expect(safetyFor(gated, { ...external, scope: 'folder' })).toEqual({ kind: 'gated' });
  });
});
