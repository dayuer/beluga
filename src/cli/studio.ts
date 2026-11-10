import path from 'node:path';
import type { SocketClient } from '../ipc/socket-client.js';
import type { StudioLinkResult, StudioStatus } from '../studio/service.js';
import type { Project } from '../workspaces/types.js';
import { UsageError } from './args.js';
import { type Exit, type Io } from './io.js';

/**
 * `beluga studio`: connect this Mac to a Synon Studio, see the link, share a project, disconnect
 * (docs/studio-daemon.md §7.3). The link itself lives in the daemon; these are its `studio.*` calls,
 * so a script does what the Mac's ⋯ menu does.
 */

export interface StudioCommands {
  status(): Promise<StudioStatus>;
  link(code: string, hub?: string, name?: string): Promise<StudioLinkResult>;
  unlink(): Promise<StudioStatus>;
  setProject(projectId: string, shared: boolean): Promise<StudioStatus>;
}

export const studioCommandsOf = (client: SocketClient): StudioCommands => ({
  status: () => client.call('studio.status'),
  link: (code, hub, name) => client.call('studio.link', code, hub, name),
  unlink: () => client.call('studio.unlink'),
  setProject: (projectId, shared) => client.call('studio.setProject', projectId, shared),
});

/** What each refusal means, in words someone can act on (the daemon answers with codes only). */
const WORDS: Readonly<Record<string, string>> = {
  'bad-code': 'That binding code is not right, or it has expired. Get a fresh one from the studio’s admin page.',
  'expired-code': 'That binding code has expired. Get a fresh one from the studio’s admin page.',
  'bad-hub': 'The hub address must be https anywhere, or http on this computer (localhost).',
  unreachable: 'Could not reach the studio hub. Is it running?',
  'clock-skew': 'This Mac’s clock is more than five minutes off. Set it and try again.',
  'key-taken': 'That key is already registered somewhere else. Start over from the admin page.',
  'already-linked': 'This Mac is already connected to Studio. Run `beluga studio unlink` first.',
  'cannot-save': 'Could not write ~/.beluga/studio.json.',
  'demo-mode': 'Studio is off in a demo run.',
};

const STATE_WORDS: Readonly<Record<string, string>> = {
  unlinked: 'not connected',
  connecting: 'connecting',
  online: 'online',
  offline: 'offline, reconnecting',
  revoked: 'revoked: connect again with a new code',
  outdated: 'this app is older than the studio hub: update Beluga',
  'clock-skew': 'this Mac’s clock is off by more than five minutes',
  'wrong-studio': 'that link belongs to another studio: connect again',
  stopped: 'stopped',
};

/** The project a path is in: the deepest project root that contains it. */
export function projectAt(projects: readonly Project[], dir: string): Project | undefined {
  const target = path.resolve(dir);
  return projects
    .filter((p) => target === p.root || target.startsWith(`${p.root}${path.sep}`))
    .sort((a, b) => b.root.length - a.root.length)[0];
}

/** A few lines a person can read: the state, the studio, and which projects go to customers. */
export function statusLines(status: StudioStatus): string[] {
  if (!status.linked) return ['Synon Studio: not connected.', 'Connect with `beluga studio link <code>` (the code is on the studio’s admin page).'];
  const shared = status.projects.filter((p) => p.shared);
  const lines = [
    `Synon Studio: ${STATE_WORDS[status.state] ?? status.state}`,
    `Hub: ${status.hub ?? ''}`.trimEnd(),
    `Daemon: ${status.daemonId ?? ''}${status.name ? ` (${status.name})` : ''}`.trimEnd(),
  ];
  if (status.retryAt !== undefined) lines.push(`Next try: in ${Math.max(0, Math.round((status.retryAt - Date.now()) / 1000))}s`);
  if (status.lastError) lines.push(`Last problem: ${status.lastError}`);
  lines.push(shared.length > 0 ? `Shared: ${shared.map((p) => `${p.projectId} (${p.plans} plan${p.plans === 1 ? '' : 's'})`).join(', ')}` : 'Shared: nothing yet (`beluga studio share`).');
  return lines;
}

export interface StudioFlags {
  readonly json?: boolean;
  readonly hub?: string;
  readonly name?: string;
}

/** One `beluga studio …` command, already attached to the running daemon. */
export async function runStudio(c: StudioCommands, projects: readonly Project[], sub: string, rest: readonly string[], flags: StudioFlags, io: Io): Promise<Exit> {
  const show = async (status: StudioStatus): Promise<Exit> => {
    io.out(flags.json === true ? `${JSON.stringify(status, null, 2)}\n` : `${statusLines(status).join('\n')}\n`);
    return 0;
  };

  switch (sub) {
    case 'link': {
      const code = rest[0];
      if (!code) throw new UsageError('`beluga studio link` needs the binding code from the studio’s admin page.', 'studio');
      const result = await c.link(code, flags.hub, flags.name);
      if (!result.ok) {
        io.err(`${WORDS[result.error] ?? `Studio said no: ${result.error}`}\n`);
        return 1;
      }
      io.out('Connected.\n');
      return show(result.status);
    }
    case 'status':
      return show(await c.status());
    case 'unlink': {
      // Say what was published before it goes, so the line is useful even offline.
      const before = await c.status();
      const status = await c.unlink();
      const shared = before.projects.filter((p) => p.shared);
      io.out(shared.length > 0 ? `Disconnected. ${shared.length} project${shared.length === 1 ? '' : 's'} no longer shared.\n` : 'Disconnected.\n');
      return show(status);
    }
    case 'share':
    case 'unshare': {
      const where = rest.length > 0 ? rest.join(' ') : process.cwd();
      const project = projectAt(projects, where);
      if (!project) {
        io.err(`${path.resolve(where)} is not inside a Beluga project.\n`);
        return 1;
      }
      const status = await c.setProject(project.id, sub === 'share');
      const now = status.projects.find((p) => p.projectId === project.id)?.shared === true;
      io.out(`${project.name}: ${now ? 'shared with Studio' : 'no longer shared'}.\n`);
      if (now) io.err('To show it to customers, map it to this Mac on the studio’s admin page (Projects › Map to daemon).\n');
      return 0;
    }
    default:
      throw new UsageError(`\`beluga studio\` can link, status, unlink, share or unshare; there’s no \`${sub}\`.`, 'studio');
  }
}
