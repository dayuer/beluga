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
 */
import type { Actor, Issue } from '../../core/board/model.js';
import type { Action } from '../../core/store.js';
import { listOrder } from '../../core/board/model.js';
import type { Board } from '../../core/board/board.js';
import type { TeamBoardSync } from '../../core/team/board-sync.js';
import type { TeamBoards, TeamPart } from '../../core/team/service.js';
import type { TrustLevel } from '../../shared/settings-schema.js';
import { assignerOf, eligible } from './eligible.js';
import { autoActor, isAutoRunning } from './marker.js';
import type { FederationSettings } from './settings.js';

/** Runs `fn` a little later; everything asked for meanwhile is one pass. */
export type Defer = (fn: () => void) => void;
export const COALESCE_MS = 200;

const later: Defer = (fn) => {
  const t = setTimeout(fn, COALESCE_MS);
  (t as { unref?: () => void }).unref?.();
};

export interface AcceptDeps {
  readonly team: Pick<TeamBoards, 'self' | 'nameOf'>;
  readonly board: Pick<Board, 'list' | 'get'>;
  readonly sync: Pick<TeamBoardSync, 'shared' | 'onChange'>;
  /** work.start(id, { claude: true, quiet: true, by }) */
  readonly start: (issueId: string, by: Actor) => Promise<unknown>;
  readonly settings: () => FederationSettings;
  readonly trustOf: (peerId: string) => TrustLevel;
  /** A worktree still there (not archived). */
  readonly live: (workspaceId: string) => boolean;
  readonly defer?: Defer;
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
      if (c.won.assignee || c.won.status) this.schedule();
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

  /** Resolves once no pass is running (tests). */
  async settled(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  stop(): void {
    this.stopped = true;
  }

  private async pass(): Promise<void> {
    const s = this.d.settings();
    if (s.accept === 'off') return;
    const self = this.d.team.self;
    const issues = this.d.board.list();
    let running = issues.filter((i) => isAutoRunning(i, self, this.d.live)).length;
    const statusOf = (id: string) => this.d.board.get(id)?.status;
    for (const issue of [...issues].sort(listOrder)) {
      if (this.stopped || running >= s.atOnce) return;
      const shared = this.d.sync.shared(issue.id);
      const l = shared?.fields.assignee?.l;
      if (l !== undefined && this.failed.get(issue.id) === l) continue;
      // The board as it is now: an earlier start in this pass may have moved things.
      const now = this.d.board.get(issue.id) ?? issue;
      const ok = eligible(now, { self, sharedOf: (id) => this.d.sync.shared(id), trustOf: this.d.trustOf, from: s.from, running, atOnce: s.atOnce, statusOf });
      if (!ok.ok) continue;
      const assigner = assignerOf(shared)!;
      running++;
      try {
        await this.d.start(issue.id, autoActor(self, this.d.team.nameOf(self), assigner, this.d.team.nameOf(assigner)));
        this.d.log?.(`federation: started ${issue.key} for ${this.d.team.nameOf(assigner)}`);
      } catch (e) {
        if (l !== undefined) this.failed.set(issue.id, l);
        this.d.log?.(`federation: couldn't start ${issue.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

const signature = (i: Issue): string => `${i.status}|${i.worktrees.length}|${i.worktreeGone ? 1 : 0}`;
