import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { belugaHome } from '../../../core/home.js';
import { writeJson } from '../../../workspaces/store.js';
import { BUILTIN_ACP_AGENTS } from './catalog.js';
import { findAcpCommand } from './connection.js';
import { type AcpAgentSpec, RUNTIME_ID, acpRuntimeId, specProblem } from './spec.js';

/**
 * The ACP agents you added (BLG-ACP), kept in ~/.beluga/acp-agents.json (0600): ones installed
 * from the ACP Registry (registry.ts) and local commands of yours. With the built-in ones whose
 * CLI is on this computer, they're the ACP agents the picker offers. A built-in one you turned off
 * (`hidden`) stays out until you add it again.
 */

/** Ids the other runtimes own: no ACP agent may take one. */
const RESERVED = new Set(['claude', 'codex', 'opencode', 'copilot', 'antigravity', 'local', 'fake']);

const Spec = z.object({
  id: z.string().regex(RUNTIME_ID),
  label: z.string().min(1).max(64),
  command: z.string().min(1).max(1024),
  args: z.array(z.string().max(1024)).max(32),
  env: z.record(z.string(), z.string().max(4096)).optional(),
  source: z.enum(['registry', 'local']),
  registryId: z.string().max(128).optional(),
  version: z.string().max(128).optional(),
  website: z.string().max(512).optional(),
  description: z.string().max(1000).optional(),
  install: z.string().max(500).optional(),
});

const File = z.object({
  agents: z.array(Spec).max(100).default([]),
  /** Built-in agents turned off here. */
  hidden: z.array(z.string()).max(100).default([]),
});
type AgentsFile = z.infer<typeof File>;

export const acpAgentsFile = (home: string = belugaHome()): string => path.join(home, 'acp-agents.json');

export class AcpAgents {
  private cached: { readonly at: number; readonly found: readonly AcpAgentSpec[] } | undefined;

  constructor(
    private readonly deps: {
      readonly file?: string;
      /** Whether a built-in agent's CLI is here (tests: a fixed answer). */
      readonly installed?: (spec: AcpAgentSpec) => boolean;
      readonly now?: () => number;
    } = {},
  ) {}

  private get file(): string {
    return this.deps.file ?? acpAgentsFile();
  }

  private read(): AgentsFile {
    try {
      return File.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return { agents: [], hidden: [] };
    }
  }

  private write(next: AgentsFile): void {
    writeJson(this.file, next);
    this.cached = undefined;
  }

  /** The agents you added (Registry and local), as specs. */
  added(): AcpAgentSpec[] {
    return this.read().agents.map((a) => ({ ...a }) as AcpAgentSpec);
  }

  /**
   * Every ACP agent the picker offers: the ones you added, then the built-in ones whose CLI is on
   * this computer (and not turned off). Kept 30 s: finding a CLI walks a few folders.
   */
  list(): readonly AcpAgentSpec[] {
    const now = (this.deps.now ?? Date.now)();
    if (this.cached && now - this.cached.at < 30_000) return this.cached.found;
    const file = this.read();
    const installed = this.deps.installed ?? ((spec: AcpAgentSpec) => Boolean(findAcpCommand(spec)));
    const added = file.agents.map((a) => ({ ...a }) as AcpAgentSpec);
    const ids = new Set(added.map((a) => a.id));
    const builtins = BUILTIN_ACP_AGENTS.filter((b) => !ids.has(b.id) && !file.hidden.includes(b.id) && installed(b));
    const found = [...added, ...builtins];
    this.cached = { at: now, found };
    return found;
  }

  /** One by its runtime id (added, or a built-in one that's here or could be). */
  get(id: string): AcpAgentSpec | undefined {
    return this.list().find((a) => a.id === id) ?? this.added().find((a) => a.id === id);
  }

  /** Add (or replace) an agent: a Registry install or a command of yours. Refused, with why, when it can't be. */
  add(spec: Omit<AcpAgentSpec, 'source'> & { readonly source: 'registry' | 'local' }): { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string } {
    const problem = specProblem(spec);
    if (problem) return { ok: false, error: problem };
    if (RESERVED.has(spec.id)) return { ok: false, error: `“${spec.id}” is taken by one of Beluga’s own agents.` };
    const file = this.read();
    const parsed = Spec.safeParse({ ...spec });
    if (!parsed.success) return { ok: false, error: 'That agent can’t be added as it is.' };
    this.write({ agents: [...file.agents.filter((a) => a.id !== spec.id), parsed.data], hidden: file.hidden.filter((h) => h !== spec.id) });
    return { ok: true, id: spec.id };
  }

  /** A local command of yours as an agent: its id from its name (`acp-<name>`). */
  addLocal(input: { readonly label: string; readonly command: string; readonly args?: readonly string[]; readonly env?: Readonly<Record<string, string>> }): { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string } {
    return this.add({ id: acpRuntimeId(input.label), label: input.label.trim(), command: input.command.trim(), args: [...(input.args ?? [])], ...(input.env && Object.keys(input.env).length ? { env: { ...input.env } } : {}), source: 'local' });
  }

  /** Remove an added agent, or turn a built-in one off. */
  remove(id: string): boolean {
    const file = this.read();
    const had = file.agents.some((a) => a.id === id);
    const builtin = BUILTIN_ACP_AGENTS.some((b) => b.id === id);
    if (!had && !builtin) return false;
    this.write({ agents: file.agents.filter((a) => a.id !== id), hidden: builtin && !file.hidden.includes(id) ? [...file.hidden, id] : file.hidden });
    return true;
  }

  /** Turn a built-in agent back on (it shows once its CLI is here). */
  restore(id: string): void {
    const file = this.read();
    if (file.hidden.includes(id)) this.write({ ...file, hidden: file.hidden.filter((h) => h !== id) });
  }

  /** Forget what was found (a CLI just installed). */
  refresh(): void {
    this.cached = undefined;
  }
}

/** This computer's ACP agents (one per daemon). */
export const acpAgents = new AcpAgents();
