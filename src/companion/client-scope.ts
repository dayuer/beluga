import type { DomainState } from '../core/store.js';

/**
 * What a customer's phone (a `client` device, BLG-14) may do, much less than your own phone
 * (coverage.ts): talk in its project's conversations, answer the cards that wait there, and see
 * its screenshots. Anything not named here is refused; what is named is refused unless it
 * belongs to the client's project. Pure over the state, so the host and the tests share it.
 */

/** The only API methods a client may call. Each one names the conversation it touches (see `channelsOf`). */
export const CLIENT_METHODS: ReadonlySet<string> = new Set(['session.submit', 'host.answerApproval', 'questions.answer', 'questions.pick', 'companion.older']);

/** Frames a client may not send at all: terminals. */
export const CLIENT_BLOCKED_FRAMES: ReadonlySet<string> = new Set(['term_attach', 'term_detach', 'term_input']);

export const clientMay = (method: string): boolean => CLIENT_METHODS.has(method);

/** The workspace ids of a project (by id). */
export const projectWorkspaces = (state: DomainState, project: string): ReadonlySet<string> =>
  new Set(state.projects.filter((p) => p.id === project).flatMap((p) => p.workspaces.filter((w) => !w.archived).map((w) => w.id)));

/** Is this channel (`ws:<id>`) a conversation of the project? The room, Your Mac and friends' chats never are. */
export const channelInProject = (state: DomainState, project: string, channel: unknown): boolean => typeof channel === 'string' && channel.startsWith('ws:') && projectWorkspaces(state, project).has(channel.slice(3));

/** A `conv:` topic of the project's. */
export const topicInProject = (state: DomainState, project: string, topic: string): boolean => {
  // A client sees its own two topics: `client` and `client:<workspace id>`. The Mac's `conv:` views carry code, steps and files, so it never gets those.
  if (topic === 'client') return true;
  return topic.startsWith('client:') && channelInProject(state, project, `ws:${topic.slice('client:'.length)}`);
};

/** Why a client's call is refused, or undefined when it may go ahead. */
export function clientRefusal(state: DomainState, project: string, method: string, args: readonly unknown[]): string | undefined {
  if (!clientMay(method)) return `${method} isn’t available to you`;
  let channel: unknown;
  switch (method) {
    case 'session.submit':
      channel = (args[1] as { channel?: unknown } | null | undefined)?.channel;
      break;
    case 'host.answerApproval':
      channel = state.approvals.find((a) => a.id === args[1])?.channel;
      break;
    case 'questions.answer':
    case 'questions.pick':
      channel = state.questions.find((q) => q.qid === args[0])?.channel;
      break;
    case 'companion.older':
      return typeof args[0] === 'string' && args[0].startsWith('client:') && topicInProject(state, project, args[0]) ? undefined : 'That conversation isn’t yours';
  }
  return channelInProject(state, project, channel) ? undefined : 'That isn’t in your project';
}
