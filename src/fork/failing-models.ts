import type { AgentRef } from '../protocol.js';
import type { RuntimeModel } from '../shared/agent-runtimes.js';

/**
 * Fork: models known not to work right now, on this Mac. The background look at an endpoint
 * (core/local-endpoints.ts) counts any answer as up, so a wrong address or a model the endpoint
 * doesn't have looked fine in the pickers and to auto route. A model lands here when a plan's task
 * on it failed for sure (fork/plans/fixer.ts), or when its endpoint was saved though its check
 * didn't pass (ipc/fork-handlers.ts). While it's here the picker greys it with why, auto route skips
 * it, and a plan's work that would start on it starts one rung up (fork/plans/ladder.ts). It leaves
 * after FAILING_MS (it's tried again), or when its endpoint is saved passing its check.
 */

/** How long a model counts as failing before it's tried again. */
export const FAILING_MS = 30 * 60_000;

interface Mark {
  readonly why: string;
  readonly at: number;
}

/** One model's name here: its runtime and model, as an agent has them. */
export const modelKey = (a: Pick<AgentRef, 'runtime' | 'model'>): string => `${a.runtime}:${a.model ?? ''}`;

export class FailingModels {
  private readonly marks = new Map<string, Mark>();
  /** Told when what fails changed: the pickers' lists are worth publishing again (set by core/session-parts.ts; one daemon, one session). */
  onChange: (() => void) | undefined;

  /** It failed: greyed from now. `why`: a line for the picker. */
  mark(key: string, why: string, now = Date.now()): void {
    const had = this.marks.get(key);
    this.marks.set(key, { why: why.slice(0, 200), at: now });
    if (!had || had.why !== why) this.tell();
  }

  /** Why it can't be used now; undefined: nothing says it fails (or that was long ago). */
  why(key: string, now = Date.now()): string | undefined {
    const m = this.marks.get(key);
    if (!m) return undefined;
    if (now - m.at >= FAILING_MS) {
      this.marks.delete(key);
      return undefined;
    }
    return m.why;
  }

  /** An endpoint's models are worth trying again (it was saved passing its check, or removed). */
  clearEndpoint(id: string): void {
    this.clearWhere((k) => k.startsWith(`local:${id}/`));
  }

  /** Everything is tried again (tests start clean). */
  clear(): void {
    this.clearWhere(() => true);
  }

  /** The 'local' runtime's picker rows, the failing ones greyed with why (core/session-parts.ts). */
  grey(models: readonly RuntimeModel[], now = Date.now()): RuntimeModel[] {
    return models.map((m) => {
      if (m.why) return m;
      const why = this.why(`local:${m.value}`, now);
      return why ? { ...m, description: why, why } : m;
    });
  }

  private clearWhere(which: (key: string) => boolean): void {
    let any = false;
    for (const k of [...this.marks.keys()]) if (which(k)) any = this.marks.delete(k) || any;
    if (any) this.tell();
  }

  private tell(): void {
    this.onChange?.();
  }
}

/** This daemon's (one per process: the handlers, the plans and the pickers all read the same). */
export const failingModels = new FailingModels();
