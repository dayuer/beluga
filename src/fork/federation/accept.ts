/**
 * Auto accept (fork, docs/federation.md): a Ready task a teammate gives this computer starts by
 * itself, with Claude, when you trust them enough and there's room (`atOnce`). Each pass works it
 * out again from the board (reconcile): what auto accept already runs is read off the board too
 * (marker.ts), so a restart neither starts a task twice nor forgets what it started.
 * Off (the default): nothing is read, nothing is listened to and nothing starts.
 *
 * When: a teammate's change to who it's for or its status (sync.onChange), a task here moving
 * (board_issue: status or worktrees), a teammate coming online, settings turned on, and once at
 * start. A burst of these is one pass (`defer`, COALESCE_MS by default).
 *
 * The pool ('pool', milestone 2, claim.ts): a Ready task with the pool label and nobody on it is
 * claimed (assignee set to this computer), then confirmed after `confirmDelay` (`after`): still
 * ours on the board, it starts. Which claims wait for their confirm is read off the board too
 * (`pickPending`), so a restart between claim and confirm confirms it once, later. Two Macs that
 * claim at once: the board's merge keeps one assignee, the other's confirm finds it lost. Cut off
 * from each other, both may start: once merged, the one that lost stops its agent and archives the
 * worktree auto accept made (`stopAndArchive`); a worktree started by hand is never touched.
 */
import type { Actor, Issue } from '../../core/board/model.js';
import type { Action } from '../../core/store.js';
import { listOrder, worktreeDoing } from '../../core/board/model.js';
import type { Board } from '../../core/board/board.js';
import type { TeamBoardSync } from '../../core/team/board-sync.js';
import type { TeamBoards, TeamPart } from '../../core/team/service.js';
import type { TrustLevel } from '../../shared/settings-schema.js';
import { assignerOf, eligible, poolGiverOf } from './eligible.js';
import { type ClaimCtx, confirmDelay, pickClaimable, pickPending, stillMine } from './claim.js';
import { autoActor, isAutoRunning, isAutoStarted } from './marker.js';
import type { FederationSettings } from './settings.js';

/** Runs `fn` a little later; everything asked for meanwhile is one pass. */
export type Defer = (fn: () => void) => void;
export const COALESCE_MS = 200;

const later: Defer = (fn) => {
  const t = setTimeout(fn, COALESCE_MS);
  (t as { unref?: () => void }).unref?.();
};

/** Runs `fn` after `ms` (a clock the tests drive). */
export type After = (ms: number, fn: () => void) => void;

const laterBy: After = (ms, fn) => {
  const t = setTimeout(fn, ms);
  (t as { unref?: () => void }).unref?.();
};

export interface AcceptDeps {
  readonly team: Pick<TeamBoards, 'self' | 'nameOf'>;
  /** `update`: a claim sets who it's for (the pool only). */
  readonly board: Pick<Board, 'list' | 'get' | 'update'>;
  readonly sync: Pick<TeamBoardSync, 'shared' | 'onChange'>;
  /** work.start(id, { claude: true, quiet: true, by }) */
  readonly start: (issueId: string, by: Actor) => Promise<unknown>;
  readonly settings: () => FederationSettings;
  readonly trustOf: (peerId: string) => TrustLevel;
  /** A worktree still there (not archived). */
  readonly live: (workspaceId: string) => boolean;
  readonly defer?: Defer;
  /** The wait between a claim and its confirm (default: a timer). */
  readonly after?: After;
  /** The random source for `confirmDelay` (default Math.random). */
  readonly random?: () => number;
  /** Stop the agent in a worktree and archive it (the pool's loser; parts.ts wires the session). */
  readonly stopAndArchive?: (workspaceId: string) => Promise<void>;
  readonly log?: (line: string) => void;
}

export class FederationAccept implements TeamPart {
  protected stopped = false;
  private inFlight: Promise<void> | undefined;
  private again = false;
  /** Tasks whose start failed, with the assignment (its Lamport time) it failed for: a new assignment tries again. */
  private readonly failed = new Map<string, number>();

  private subscribed = false;
  private pending = false;
  /** What each task looked like at the last board_issue (status, worktrees): only a change there asks for a pass. */
  private readonly seen = new Map<string, string>();
  /** Claims with a confirm queued (dedupe only: lost on a restart, read off the board again). */
  private readonly confirming = new Set<string>();
  /** Starts a confirm is running. */
  private readonly jobs = new Set<Promise<void>>();
  /** Worktrees already handed to stopAndArchive. */
  private readonly retired = new Set<string>();

  constructor(protected readonly d: AcceptDeps) {
    if (this.on()) {
      this.subscribe();
      this.schedule();
    }
  }

  linkUp(): void {
    this.schedule();
  }

  onAction(action: Action): void {
    if (action.type === 'prefs') {
      if (this.on() && !this.subscribed) {
        this.subscribe();
        this.schedule();
      }
      return;
    }
    if (action.type !== 'board_issue') return;
    const sig = signature(action.issue);
    const was = this.seen.get(action.issue.id);
    this.seen.set(action.issue.id, sig);
    if (was !== undefined && was !== sig) this.schedule();
  }

  private on(): boolean {
    return !this.stopped && this.d.settings().accept !== 'off';
  }

  private subscribe(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.d.sync.onChange((c) => {
      if (c.won.assignee || c.won.status || (c.won.labels && this.d.settings().accept === 'pool')) this.schedule();
    });
  }

  /** Ask for a pass soon; asked again before it runs, still one. */
  private schedule(): void {
    if (this.pending || !this.on()) return;
    this.pending = true;
    (this.d.defer ?? later)(() => {
      this.pending = false;
      if (!this.stopped) void this.reconcile();
    });
  }

  /** Start what should start now. Never two at once: a call while one runs makes it run once more after. */
  reconcile(): Promise<void> {
    if (this.stopped || this.d.settings().accept === 'off') return this.inFlight ?? Promise.resolve();
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const run = async (): Promise<void> => {
      try {
        do {
          this.again = false;
          await this.pass();
        } while (this.again && !this.stopped);
      } finally {
        this.inFlight = undefined;
      }
    };
    this.inFlight = run();
    return this.inFlight;
  }

  /** Resolves once no pass and no confirmed start is running (tests). */
  async settled(): Promise<void> {
    while (this.inFlight || this.jobs.size > 0) {
      if (this.inFlight) await this.inFlight;
      else await Promise.all([...this.jobs]);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private claimCtx(s: FederationSettings, running: number): ClaimCtx {
    return {
      self: this.d.team.self,
      sharedOf: (id) => this.d.sync.shared(id),
      trustOf: this.d.trustOf,
      from: s.from,
      running,
      atOnce: s.atOnce,
      statusOf: (id) => this.d.board.get(id)?.status,
      accept: s.accept,
      poolLabel: s.poolLabel,
    };
  }

  private actorFor(giver: string): Actor {
    const self = this.d.team.self;
    return autoActor(self, this.d.team.nameOf(self), giver, this.d.team.nameOf(giver));
  }

  private async pass(): Promise<void> {
    const s = this.d.settings();
    if (s.accept === 'off') return;
    const self = this.d.team.self;
    const issues = this.d.board.list();
    if (s.accept === 'pool') await this.retireLost(issues, s.poolLabel);
    let running = issues.filter((i) => isAutoRunning(i, self, this.d.live)).length;
    // Claimed here, not confirmed yet: each holds a place (the pool only).
    const pending = pickPending(issues, this.claimCtx(s, running));
    for (const p of pending) {
      const l = this.d.sync.shared(p.id)?.fields.assignee?.l;
      if (l !== undefined && this.failed.get(p.id) === l) continue;
      if (!this.confirming.has(p.id)) this.queueConfirm(p.id);
    }
    for (const issue of [...issues].sort(listOrder)) {
      if (this.stopped || running + pending.length >= s.atOnce) break;
      const shared = this.d.sync.shared(issue.id);
      const l = shared?.fields.assignee?.l;
      if (l !== undefined && this.failed.get(issue.id) === l) continue;
      // The board as it is now: an earlier start in this pass may have moved things.
      const now = this.d.board.get(issue.id) ?? issue;
      const ok = eligible(now, this.claimCtx(s, running + pending.length));
      if (!ok.ok) continue;
      const assigner = assignerOf(shared)!;
      running++;
      try {
        await this.d.start(issue.id, this.actorFor(assigner));
        this.d.log?.(`federation: started ${issue.key} for ${this.d.team.nameOf(assigner)}`);
      } catch (e) {
        if (l !== undefined) this.failed.set(issue.id, l);
        this.d.log?.(`federation: couldn't start ${issue.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (this.stopped || s.accept !== 'pool') return;
    // Claims: synchronous, so two passes run back to back claim in the same tick.
    for (const issue of pickClaimable(this.d.board.list(), this.claimCtx(s, running))) {
      const giver = poolGiverOf(this.d.sync.shared(issue.id))!;
      try {
        this.d.board.update(issue.id, { assignee: { kind: 'person', id: self, name: this.d.team.nameOf(self) } }, this.actorFor(giver));
      } catch (e) {
        this.d.log?.(`federation: couldn't claim ${issue.key}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      this.d.log?.(`federation: claimed ${issue.key}`);
      this.queueConfirm(issue.id);
    }
  }

  /**
   * Pool tasks auto accept started here that someone else has now (the board merged their claim
   * over ours): stop and archive our worktree, once. Cleared (nobody on it) is left alone.
   */
  private async retireLost(issues: readonly Issue[], poolLabel: string): Promise<void> {
    const self = this.d.team.self;
    for (const issue of issues) {
      if (this.stopped) return;
      if (!issue.labels.includes(poolLabel) || !issue.assignee || issue.assignee.id === self || !isAutoStarted(issue, self)) continue;
      const ws = worktreeDoing(issue, this.d.live);
      if (!ws || this.retired.has(ws)) continue;
      this.retired.add(ws);
      try {
        await this.d.stopAndArchive?.(ws);
        this.d.log?.(`federation: ${issue.key} went to ${issue.assignee.name}: stopped and archived ${ws}`);
      } catch (e) {
        this.d.log?.(`federation: couldn't archive ${ws}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** After the wait, start a claim that's still ours. No places are counted here: the claim already holds one. */
  private queueConfirm(id: string): void {
    this.confirming.add(id);
    (this.d.after ?? laterBy)(confirmDelay(this.d.random ?? Math.random), () => {
      const s = this.d.settings();
      const self = this.d.team.self;
      if (this.stopped || s.accept !== 'pool') return void this.confirming.delete(id);
      const now = this.d.board.get(id);
      if (!stillMine(now, self)) {
        this.d.log?.(`federation: lost the claim on ${now?.key ?? id}`);
        return void this.confirming.delete(id);
      }
      if (pickPending([now!], this.claimCtx(s, 0)).length === 0) return void this.confirming.delete(id);
      const shared = this.d.sync.shared(id);
      const l = shared?.fields.assignee?.l;
      const giver = poolGiverOf(shared)!;
      const job: Promise<void> = this.d
        .start(id, this.actorFor(giver))
        .then(
          () => this.d.log?.(`federation: started ${now!.key} from the pool`),
          (e: unknown) => {
            if (l !== undefined) this.failed.set(id, l);
            this.d.log?.(`federation: couldn't start ${now!.key}: ${e instanceof Error ? e.message : String(e)}`);
          },
        )
        .finally(() => {
          this.jobs.delete(job);
          this.confirming.delete(id);
        });
      this.jobs.add(job);
    });
  }
}

const signature = (i: Issue): string => `${i.status}|${i.worktrees.length}|${i.worktreeGone ? 1 : 0}`;
