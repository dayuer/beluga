import type { DomainState } from '../core/store.js';
import { CLIENT_METHODS, channelInProject } from './client-scope.js';
import { allNeeds } from './needs-you.js';
import type { ClientCard, ClientConvView, ClientHomeView, ClientTurn, NeedsYou, OutputView, Topic, TurnView } from './protocol.js';
import { convTurns, convView, type ViewContext } from './views.js';

/**
 * What a customer's phone sees (BLG-16): its project's conversations as plain words, the cards
 * that wait for it, and pictures. Claude's code never goes (the placeholders are cut out), nor
 * steps, tool trails, files, branches or merges: only fields named here are copied.
 */

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** `client:<workspace id>` → the conversation's channel (`ws:<id>`). */
export const clientChannel = (topic: string): string | undefined => (topic.startsWith('client:') ? `ws:${topic.slice('client:'.length)}` : undefined);
const clientTopic = (channel: string): string => `client:${channel.slice('ws:'.length)}`;

const URL_RE = /https:\/\/[^\s)<>"']+/g;
const CODE_MARK = /\[\[code(?::\d+)?\]\]/g;

function card(n: NeedsYou): ClientCard | undefined {
  if (!n.topic?.startsWith('conv:ws:')) return undefined;
  // Only buttons whose calls a client may make (client-scope.ts).
  const actions = n.actions.filter((a) => CLIENT_METHODS.has(a.method));
  const answer = n.answer && CLIENT_METHODS.has(n.answer.method) ? n.answer : undefined;
  if (!actions.length && !answer) return undefined;
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    ...(n.detail ? { detail: clip(n.detail.replace(CODE_MARK, ''), 4000) } : {}),
    topic: clientTopic(n.topic.slice('conv:'.length)),
    ...(n.askedAt !== undefined ? { askedAt: n.askedAt } : {}),
    ...(n.choices ? { choices: n.choices } : {}),
    ...(n.freeText ? { freeText: true } : {}),
    actions,
    ...(answer ? { answer } : {}),
  };
}

/** The cards waiting in this project's conversations. */
export function clientCards(state: DomainState, project: string): ClientCard[] {
  return allNeeds(state).flatMap((n) => {
    const c = n.topic?.startsWith('conv:') && channelInProject(state, project, n.topic.slice('conv:'.length)) ? card(n) : undefined;
    return c ? [c] : [];
  });
}

const isImage = (o: OutputView): boolean => o.kind === 'image';

export function clientHome(state: DomainState, ctx: ViewContext, project: string): ClientHomeView | undefined {
  const p = state.projects.find((x) => x.id === project);
  if (!p) return undefined;
  const cards = clientCards(state, project);
  const conversations = p.workspaces
    .filter((w) => !w.archived && !w.pending && w.kind !== 'main')
    .map((w) => {
      const topic = clientTopic(`ws:${w.id}`);
      return { topic, title: clip(w.name, 300), working: convView(state, ctx, `conv:ws:${w.id}` as Topic).working, cards: cards.filter((c) => c.topic === topic).length };
    });
  return { project: { id: p.id, name: clip(p.name, 200) }, conversations, cards: cards.slice(0, 50) };
}

function safeTurns(turns: readonly TurnView[]): ClientTurn[] {
  return turns.map((t) => {
    const text = clip(t.prose.text.replace(CODE_MARK, ''), 20_000).trim();
    return {
      id: t.id,
      who: t.who,
      name: t.name,
      text,
      ts: t.ts,
      ...(t.status === 'working' || t.status === 'queued' ? { working: true } : {}),
      images: (t.outputs ?? []).filter(isImage),
      links: [...new Set(text.match(URL_RE) ?? [])].slice(0, 5),
    };
  });
}

/** Turns before one the client has (companion.older), cut down the same way. */
export function clientOlder(state: DomainState, ctx: ViewContext, project: string, topic: string, before: string, limit?: number): { turns: ClientTurn[]; more: boolean } {
  const channel = clientChannel(topic);
  if (!channel || !channelInProject(state, project, channel)) throw new Error('That conversation isn’t yours');
  const { turns, more } = convTurns(state, ctx, channel, { before, ...(limit ? { limit } : {}) });
  return { turns: safeTurns(turns), more };
}

export function clientConv(state: DomainState, ctx: ViewContext, project: string, topic: string): ClientConvView | undefined {
  const channel = clientChannel(topic);
  if (!channel || !channelInProject(state, project, channel)) return undefined;
  const full = convView(state, ctx, `conv:${channel}` as Topic);
  const { turns, more } = convTurns(state, ctx, channel);
  const safe = safeTurns(turns);
  const cards = clientCards(state, project).filter((c) => c.topic === topic);
  return { topic, title: full.title, turns: safe, more, working: full.working, canSend: full.canSend, cards: cards.slice(0, 20), images: (full.outputs ?? []).filter(isImage).slice(0, 100) };
}
