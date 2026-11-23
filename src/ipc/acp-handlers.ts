import { acpAgents } from '../agent/runtime/acp-agents/agents.js';
import { BUILTIN_ACP_AGENTS } from '../agent/runtime/acp-agents/catalog.js';
import { findAcpCommand } from '../agent/runtime/acp-agents/connection.js';
import { AcpRegistry } from '../agent/runtime/acp-agents/registry.js';
import { forgetAcpStatus } from '../agent/runtime/acp-agents/status.js';
import type { Session } from '../core/session.js';
import type { Args, Method } from './api.js';

/** What each `acp.*` method does (see acp-api.ts). */

type AcpMethod = Extract<Method, `acp.${string}`>;
type AcpHandlers = { readonly [M in AcpMethod]: (s: Session, ...args: Args<M>) => unknown };

/** One ACP agent as Settings lists it. */
export interface AcpAgentView {
  readonly id: string;
  readonly label: string;
  readonly source: 'builtin' | 'registry' | 'local';
  /** Its command line, as it starts. */
  readonly command: string;
  readonly args: readonly string[];
  readonly version?: string;
  readonly registryId?: string;
  readonly website?: string;
  readonly description?: string;
  /** Its CLI is on this computer (a package runs through npx or uvx: those). */
  readonly installed: boolean;
  /** A built-in one you turned off. */
  readonly hidden?: boolean;
  /** How to install it, when it isn't here. */
  readonly install?: string;
}

let registry: AcpRegistry | undefined;
const theRegistry = (): AcpRegistry => (registry ??= new AcpRegistry(acpAgents));

/** The pickers and onboarding learn what changed: every runtime asked again. */
const changed = (s: Session): void => {
  acpAgents.refresh();
  forgetAcpStatus();
  void s.workbench?.checkAgents().catch(() => undefined);
};

export const ACP_HANDLERS = {
  'acp.agents': () => {
    const offered = new Set(acpAgents.list().map((a) => a.id));
    const added = acpAgents.added();
    const addedIds = new Set(added.map((a) => a.id));
    const view = (a: (typeof added)[number] | (typeof BUILTIN_ACP_AGENTS)[number], hidden?: boolean): AcpAgentView => ({
      id: a.id,
      label: a.label,
      source: a.source,
      command: a.command,
      args: a.args,
      ...(a.version ? { version: a.version } : {}),
      ...(a.registryId ? { registryId: a.registryId } : {}),
      ...(a.website ? { website: a.website } : {}),
      ...(a.description ? { description: a.description } : {}),
      installed: Boolean(findAcpCommand(a)),
      ...(hidden ? { hidden: true } : {}),
      ...(a.install ? { install: a.install } : {}),
    });
    const builtins = BUILTIN_ACP_AGENTS.filter((b) => !addedIds.has(b.id)).map((b) => view(b, !offered.has(b.id) && Boolean(findAcpCommand(b))));
    return { agents: [...added.map((a) => view(a)), ...builtins] };
  },
  'acp.search': (_s, query) => theRegistry().search(query),
  'acp.install': async (s, id) => {
    const done = await theRegistry().install(id);
    if (done.ok) changed(s);
    return done;
  },
  'acp.addLocal': (s, input) => {
    const done = acpAgents.addLocal(input);
    if (done.ok) changed(s);
    return done;
  },
  'acp.remove': async (s, id) => {
    const isRegistry = acpAgents.added().some((a) => a.id === id && a.source === 'registry');
    const done = isRegistry ? await theRegistry().uninstall(id) : acpAgents.remove(id);
    if (done) changed(s);
    return done;
  },
  'acp.restore': (s, id) => {
    acpAgents.restore(id);
    changed(s);
  },
} satisfies AcpHandlers;
