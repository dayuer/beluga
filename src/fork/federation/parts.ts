/**
 * Auto accept's parts for team boards (fork): what core/board/launch.ts adds to its parts in one
 * spread, the real board, sync, work and settings wired in here so launch.ts keeps two lines.
 */
import type { Board } from '../../core/board/board.js';
import type { BoardWork } from '../../core/board/work.js';
import type { TeamBoardSync } from '../../core/team/board-sync.js';
import type { TeamBoards, TeamPart } from '../../core/team/service.js';
import type { Store } from '../../core/store.js';
import type { Session } from '../../core/session.js';
import { trustOf } from '../../core/trust.js';
import { blackbox } from '../../core/blackbox/recorder.js';
import { type After, type Defer, FederationAccept } from './accept.js';
import { federationOf } from './settings.js';

export interface FederationPartDeps {
  readonly team: TeamBoards;
  readonly board: Board;
  readonly sync: TeamBoardSync;
  readonly work: Pick<BoardWork, 'start'>;
  readonly store: Pick<Store, 'getState'>;
  readonly live: (workspaceId: string) => boolean;
  /** For the pool's loser: stop the agent, archive the worktree (left out: nothing is archived). */
  readonly session?: Pick<Session, 'host' | 'workspaces'>;
}

export function federationParts(d: FederationPartDeps, inject?: { readonly defer?: Defer; readonly after?: After; readonly random?: () => number; readonly log?: (line: string) => void }): TeamPart[] {
  return [
    new FederationAccept({
      team: d.team,
      board: d.board,
      sync: d.sync,
      start: (id, by) => d.work.start(id, { claude: true, quiet: true, by }),
      settings: () => federationOf(d.store.getState().prefs.federation),
      trustOf: (p) => trustOf(d.store.getState(), p),
      live: d.live,
      ...(inject?.defer ? { defer: inject.defer } : {}),
      ...(inject?.after ? { after: inject.after } : {}),
      ...(inject?.random ? { random: inject.random } : {}),
      ...(d.session ? { stopAndArchive: stopAndArchiveIn(d.session) } : {}),
      log: inject?.log ?? ((line) => blackbox.record('log', line)),
    }),
  ];
}

/** Stop first, then archive, quietly: as the Archive button does, so the sidebar follows. */
const stopAndArchiveIn = (session: Pick<Session, 'host' | 'workspaces'>) => async (workspaceId: string): Promise<void> => {
  session.host.stopRun(`ws:${workspaceId}`, { quiet: true });
  await session.workspaces?.archive(workspaceId, false, { quiet: true });
};
