/**
 * Auto accept (fork, docs/federation.md): a Ready task a teammate gives this computer starts by
 * itself, with Claude, when you trust them enough and there's room (`atOnce`). Each pass works it
 * out again from the board (reconcile): what auto accept already runs is read off the board too
 * (marker.ts), so a restart neither starts a task twice nor forgets what it started.
 * Off (the default): nothing is read and nothing starts.
 */
import type { Actor } from '../../core/board/model.js';
import { listOrder } from '../../core/board/model.js';
import type { Board } from '../../core/board/board.js';
import type { TeamBoardSync } from '../../core/team/board-sync.js';
import type { TeamBoards, TeamPart } from '../../core/team/service.js';
import type { TrustLevel } from '../../shared/settings-schema.js';
import { assignerOf, eligible } from './eligible.js';
import { autoActor, isAutoRunning } from './marker.js';
import type { FederationSettings } from './settings.js';

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
  readonly log?: (line: string) => void;
}

export class FederationAccept implements TeamPart {
  protected stopped = false;
  private inFlight: Promise<void> | undefined;
  private again = false;
  /** Tasks whose start failed, with the assignment (its Lamport time) it failed for: a new assignment tries again. */
  private readonly failed = new Map<string, number>();

  constructor(protected readonly d: AcceptDeps) {}

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
