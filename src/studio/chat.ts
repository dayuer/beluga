import type { Plan } from '../core/plans/model.js';
import { customerTurns } from '../core/plans/customer-turns.js';
import { type LogItem, type Store, isRunning } from '../core/store.js';
import { LIMITS, type StudioTurn } from './protocol.js';
import type { StudioConfig } from './keys.js';
import { wrapCustomerText } from './actions.js';
import type { StudioExtras } from './publish.js';

/**
 * The customer's conversation with a plan (docs/studio-gates.md §5, decision chat-channel).
 *
 * A customer's message is queued, then submitted to the plan's own conversation (`plan.home`) when
 * nothing runs there: it never merges with the operator's turn. The agent's reply becomes a turn
 * only once its run has ended, and only the reply to a customer's message — the operator's own
 * messages there, and the replies to them, stay out. Every text reaches `view.ts` first, which
 * sanitizes it (paths, branches, model names, code blocks never reach the customer).
 *
 * Limits: 10 messages a minute and 50 000 characters a day per plan. The hub limits too; this is
 * the daemon's own second look. Over either, `rate-limited` and nothing is queued.
 */

export interface StudioChatSession {
  readonly host: { runningIn(channel: string): boolean };
  askOwnClaude(prompt: string, channel: string, urgent?: boolean, echo?: boolean | string, shown?: string): string | undefined;
  sendChat(text: string, byAgent: boolean, channel?: string, request?: string): void;
}

export interface ChatDeps {
  readonly store: Store;
  readonly config: () => StudioConfig | undefined;
  readonly session: StudioChatSession;
  /** The inbox owns the one file; the chat's section is written through it. */
  readonly persist: () => void;
  readonly touch: (planId?: string) => void;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export type SayResult = { readonly ok: true } | { readonly ok: false; readonly error: 'unknown-plan' | 'not-shared' };

interface Message {
  readonly planId: string;
  readonly opId: string;
  readonly requestId: string;
  readonly text: string;
  readonly at: number;
}

interface Said {
  readonly id: string;
  readonly planId: string;
  readonly text: string;
  readonly name: string;
  readonly at: number;
}

export const PER_MINUTE = 10;
export const CHARS_PER_DAY = 50_000;

const isMessage = (v: unknown): v is Message => {
  const m = v as Partial<Message> | null;
  return Boolean(m) && typeof m?.planId === 'string' && typeof m.opId === 'string' && typeof m.requestId === 'string' && typeof m.text === 'string' && typeof m.at === 'number';
};
const isSaid = (v: unknown): v is Said => {
  const s = v as Partial<Said> | null;
  return Boolean(s) && typeof s?.id === 'string' && typeof s.planId === 'string' && typeof s.text === 'string' && typeof s.name === 'string' && typeof s.at === 'number';
};
const KEEP = 500;

export class StudioChat {
  private readonly store: Store;
  private readonly config: () => StudioConfig | undefined;
  private readonly session: StudioChatSession;
  private readonly persist: () => void;
  private readonly touch: (planId?: string) => void;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  private pending: Message[] = [];
  private sent: Message[] = [];
  private said: Said[] = [];
  private seq = 0;
  private changing = false;
  private readonly last = new Map<string, string>();
  private readonly limits = new Map<string, { window: number; count: number; day: string; chars: number }>();
  private readonly unsub: () => void;

  constructor(d: ChatDeps) {
    this.store = d.store;
    this.config = d.config;
    this.session = d.session;
    this.persist = d.persist;
    this.touch = d.touch;
    this.now = d.now ?? Date.now;
    this.log = d.log ?? (() => undefined);
    this.unsub = this.store.subscribe(() => this.changed());
  }

  stop(): void {
    this.unsub();
  }

  /** Unlinked: what waited for a studio that is gone is not sent when another one links. */
  unlink(): void {
    this.pending = [];
    this.persist();
  }

  /** A customer's message: queued now, submitted to the plan's agent when nothing runs there. */
  accept(plan: Plan, opId: string, text: string): 'rate-limited' | undefined {
    if (this.limited(plan.id, text)) return 'rate-limited';
    const at = this.now();
    this.pending.push({ planId: plan.id, opId, requestId: `st-${opId}`, text: text.slice(0, LIMITS.text), at });
    this.persist();
    this.flush(plan.id);
    return undefined;
  }

  /** The operator's words to the customer (Mac only): the agent sees them, "名字 · Synon Studio" in turns. */
  say(planId: string, text: string): SayResult {
    const plan = this.plan(planId);
    if (!plan) return { ok: false, error: 'unknown-plan' };
    if (!this.config()?.projects[plan.projectId]) return { ok: false, error: 'not-shared' };
    const words = text.slice(0, LIMITS.text);
    const at = this.now();
    const self = this.store.getState().self;
    const name = `${self?.name ?? this.store.getState().network.self?.name ?? 'You'} · Synon Studio`;
    this.said.push({ id: `s-${at.toString(36)}-${this.seq++}`, planId, text: words, name, at });
    this.session.sendChat(words, false, plan.home);
    this.persist();
    this.touch(planId);
    return { ok: true };
  }

  /** What the customer sees of the conversation: their words, the agent's finished replies, yours. */
  extras(planId: string): Pick<StudioExtras, 'turns' | 'typing' | 'moreTurns'> {
    const plan = this.plan(planId);
    if (!plan) return { turns: [], typing: false, moreTurns: false };
    const turns: StudioTurn[] = [];
    for (const message of this.sent.filter((m) => m.planId === planId)) {
      const id = message.opId.slice(0, 8);
      turns.push({ id: `c-${id}`, who: 'customer', text: message.text, at: message.at, opId: message.opId });
      const item = this.item(plan.home, message.requestId);
      if (item && !isRunning(item.status) && item.text.trim()) {
        turns.push({ id: `a-${id}`, who: 'ai', text: item.text, at: item.endTs ?? item.ts });
      }
    }
    for (const said of this.said.filter((s) => s.planId === planId)) {
      turns.push({ id: said.id, who: 'studio', name: said.name, text: said.text, at: said.at });
    }
    turns.sort((a, b) => a.at - b.at);
    return {
      turns,
      typing: this.sent.some((m) => m.planId === planId && this.typing(plan, m)),
      moreTurns: turns.length > 50,
    };
  }

  // --- the file's chat section (the inbox owns the file) ---

  dump(): unknown {
    return { pending: [...this.pending], sent: this.sent.slice(-KEEP), said: this.said.slice(-KEEP) };
  }

  restore(rows: unknown): void {
    const raw = rows as { pending?: unknown; sent?: unknown; said?: unknown } | null;
    if (!raw || typeof raw !== 'object') return;
    this.pending = Array.isArray(raw.pending) ? raw.pending.filter(isMessage).slice(-KEEP) : [];
    this.sent = Array.isArray(raw.sent) ? raw.sent.filter(isMessage).slice(-KEEP) : [];
    this.said = Array.isArray(raw.said) ? raw.said.filter(isSaid).slice(-KEEP) : [];
  }

  // --- submitting ---

  /** Submit this plan's next queued message, if the plan's conversation has no run under way. */
  private flush(planId: string): void {
    const plan = this.plan(planId);
    if (!plan || this.session.host.runningIn(plan.home)) return;
    const i = this.pending.findIndex((m) => m.planId === planId);
    if (i < 0) return;
    // Off the queue before anything is dispatched: the dispatches below run `changed`, which would
    // otherwise find this same message waiting and submit it twice.
    const message = this.pending.splice(i, 1)[0]!;
    this.sent.push(message);
    this.persist();
    // The customer's turn is limited (core/plans/customer-turns.ts); forRun marks it started.
    customerTurns.begin(plan.home);
    let requestId: string | undefined;
    try {
      // The operator sees whose words these are; the agent gets the wrapped text under the same request.
      this.session.sendChat(`客户：${message.text}`, false, plan.home, message.requestId);
      requestId = this.session.askOwnClaude(wrapCustomerText(message.text), plan.home, false, false, message.requestId);
    } catch (err) {
      this.log(`could not submit a customer message: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!requestId) {
      // It never went in: back to the queue, tried again on the next change there.
      customerTurns.end(plan.home);
      const at = this.sent.lastIndexOf(message);
      if (at >= 0) this.sent.splice(at, 1);
      this.pending.unshift(message);
      this.persist();
      return;
    }
    this.touch(plan.id);
  }

  /** A store change: a customer turn's run ended, a message can go, or what the customer sees moved. */
  private changed(): void {
    if (this.changing) return;
    this.changing = true;
    try {
      const log = this.store.getState().log;
      for (const channel of customerTurns.channels()) {
        if (!customerTurns.sawRun(channel)) continue;
        // The run's item ends (done/error/denied) and nothing else runs there: the turn is over.
        const running = log.some((item) => item.type === 'agent' && item.channel === channel && isRunning(item.status));
        if (!running) customerTurns.end(channel);
      }
      for (const planId of new Set(this.pending.map((m) => m.planId))) {
        const plan = this.plan(planId);
        if (plan && !this.session.host.runningIn(plan.home)) this.flush(planId);
      }
      for (const planId of new Set([...this.sent.map((m) => m.planId), ...this.said.map((s) => s.planId)])) {
        const signature = this.signature(planId);
        if (this.last.get(planId) === signature) continue;
        this.last.set(planId, signature);
        this.touch(planId);
      }
    } finally {
      this.changing = false;
    }
  }

  private signature(planId: string): string {
    const extra = this.extras(planId);
    const last = extra.turns?.at(-1);
    return `${extra.typing ? 1 : 0}|${extra.turns?.length ?? 0}|${last?.id ?? ''}|${last?.text.length ?? 0}`;
  }

  private typing(plan: Plan, message: Message): boolean {
    const item = this.item(plan.home, message.requestId);
    if (item) return isRunning(item.status);
    // Submitted, its item not up yet: the run is starting if the conversation is busy.
    return this.session.host.runningIn(plan.home);
  }

  private item(channel: string, requestId: string): Extract<LogItem, { type: 'agent' }> | undefined {
    return this.store.getState().log.find((item): item is Extract<LogItem, { type: 'agent' }> => item.type === 'agent' && item.channel === channel && item.requestId === requestId);
  }

  private plan(planId: string): Plan | undefined {
    return this.store.getState().plans.plans.find((p) => p.id === planId);
  }

  private limited(planId: string, text: string): boolean {
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    let limit = this.limits.get(planId);
    if (!limit || limit.day !== day) {
      limit = { window: now, count: 0, day, chars: 0 };
      this.limits.set(planId, limit);
    }
    if (now - limit.window >= 60_000) {
      limit.window = now;
      limit.count = 0;
    }
    if (limit.count >= PER_MINUTE || limit.chars + text.length > CHARS_PER_DAY) return true;
    limit.count++;
    limit.chars += text.length;
    return false;
  }
}
