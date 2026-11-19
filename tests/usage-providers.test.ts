import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { usageFor, usagesOf, withUsage } from '../src/agent/usage.js';
import { CLAUDE_AGENT, PeerInfo, Profile } from '../src/protocol.js';
import { friendRooms, providerCards, shortTokens, GUEST_STALE_MS, windowHeading } from '../src/ui/usage-cards.js';

/** The Profile an older Mac (before per-provider usage) parses frames with. */
const OldWindow = z.object({ pct: z.number().min(0).max(100), resetsAt: z.number().optional() });
const OldUsage = z.object({ plan: z.string().max(32).optional(), fiveHour: OldWindow.optional(), week: OldWindow.optional(), updatedAt: z.number() });
const OldProfile = z.object({
  name: z.string().regex(/^[\w.-]{1,32}$/),
  shares: z.array(z.object({ name: z.string(), writable: z.boolean() })).max(32),
  agent: z.boolean(),
  usage: OldUsage.optional(),
  projects: z.array(z.string().max(80)).max(60).optional(),
});
const OldPeerInfo = OldProfile.extend({ peerId: z.string().min(1).max(256), host: z.boolean().optional(), guest: z.boolean().optional() });

const codex = { runtime: 'codex', label: 'Codex' };
const local = { runtime: 'local', model: 'qwen3', label: 'Qwen' };

describe('usage per provider', () => {
  const base = { name: 'kay', shares: [], agent: true };

  it('merges each update into its own provider and keeps the old field Claude’s', () => {
    let p: Profile = { ...base };
    p = { ...p, ...withUsage(p, CLAUDE_AGENT, { plan: 'max', fiveHour: { pct: 12 } }, 1) };
    p = { ...p, ...withUsage(p, codex, { windows: [{ label: 'Weekly', pct: 30 }] }, 2) };
    p = { ...p, ...withUsage(p, local, { tokens: { input: 900, output: 300 }, tokensPerSec: 41 }, 3) };
    p = { ...p, ...withUsage(p, CLAUDE_AGENT, { week: { pct: 40 } }, 4) };
    expect(usagesOf(p).map((u) => u.agent.runtime)).toEqual(['claude', 'codex', 'local']);
    expect(usageFor(p, 'claude')).toMatchObject({ plan: 'max', fiveHour: { pct: 12 }, week: { pct: 40 }, updatedAt: 4 });
    expect(usageFor(p, 'codex')).toMatchObject({ windows: [{ label: 'Weekly', pct: 30 }], updatedAt: 2 });
    expect(usageFor(p, 'codex')?.fiveHour).toBeUndefined();
    expect(usageFor(p, 'local')).toMatchObject({ agent: local, tokensPerSec: 41 });
    expect(p.usage).toEqual({ plan: 'max', fiveHour: { pct: 12 }, week: { pct: 40 }, updatedAt: 4 });
    expect(Profile.parse(p)).toEqual(p);
  });

  it('a Codex-only Mac sends no Claude usage in the old field', () => {
    const p = withUsage({}, codex, { windows: [{ label: '5h', pct: 5 }] }, 1);
    expect(p.usage).toBeUndefined();
    expect(p.usages).toHaveLength(1);
  });

  it('reads an older Mac’s single usage as Claude’s', () => {
    const old = { usage: { fiveHour: { pct: 9 }, updatedAt: 1 } };
    expect(usagesOf(old)).toEqual([{ fiveHour: { pct: 9 }, updatedAt: 1, agent: CLAUDE_AGENT }]);
    expect(usagesOf(undefined)).toEqual([]);
    // Its next update starts the list from that Claude entry.
    expect(withUsage(old, codex, { tokensPerSec: 3 }, 2).usages?.map((u) => u.agent.runtime)).toEqual(['claude', 'codex']);
  });

  it('an old client still parses current frames', () => {
    let p: Profile = { ...base };
    p = { ...p, ...withUsage(p, CLAUDE_AGENT, { plan: 'pro', fiveHour: { pct: 50, resetsAt: 9 } }, 1) };
    p = { ...p, ...withUsage(p, codex, { windows: [{ label: 'Weekly', pct: 3 }], signedIn: true }, 2) };
    const frame = JSON.parse(JSON.stringify(PeerInfo.parse({ ...p, peerId: 'abc', agents: [CLAUDE_AGENT, codex], defaultAgent: codex })));
    const seen = OldPeerInfo.parse(frame);
    expect(seen.usage).toEqual({ plan: 'pro', fiveHour: { pct: 50, resetsAt: 9 }, updatedAt: 1 });
    expect(OldProfile.parse(frame).name).toBe('kay');
  });

  it('makes one card per provider, in the shape its data has', () => {
    let p: Profile = { ...base, agents: [CLAUDE_AGENT, codex] };
    p = { ...p, ...withUsage(p, CLAUDE_AGENT, { plan: 'max', fiveHour: { pct: 12 }, week: { pct: 38 } }, 1) };
    p = { ...p, ...withUsage(p, local, { tokens: { input: 1000, output: 500 }, tokensPerSec: 38 }, 2) };
    const cards = providerCards(p, codex);
    expect(cards.map((c) => [c.key, c.shape, c.isDefault])).toEqual([
      ['claude', 'quota', false],
      ['codex', 'empty', true],
      ['local', 'tokens', false],
    ]);
    expect(cards[0]?.windows.map((w) => `${w.label} ${w.pct}`)).toEqual(['5-hour 12', 'Weekly 38']);
    expect(providerCards(p, undefined).find((c) => c.isDefault)?.key).toBe('claude');
    expect(providerCards(withUsage({}, codex, { signedIn: false }), undefined).find((c) => c.key === 'codex')?.signedIn).toBe(false);
    expect(shortTokens(1500)).toBe('2k');
    expect(shortTokens(1_234_567)).toBe('1.2M');
  });

  it('shows Antigravity’s quota on Claude’s card, under its own name', () => {
    const agy = { runtime: 'antigravity', label: 'Antigravity' };
    let p: Pick<Profile, 'usage' | 'usages' | 'agents'> = { agents: [CLAUDE_AGENT, agy] };
    // Before it has said its quota, it keeps its own card.
    expect(providerCards(p, undefined).map((c) => c.key)).toEqual(['claude', 'antigravity']);
    p = { ...p, ...withUsage(p, CLAUDE_AGENT, { plan: 'max', week: { pct: 26 } }, 1) };
    p = { ...p, ...withUsage(p, agy, { plan: 'Google AI Ultra', windows: [{ label: 'Gemini', pct: 2 }, { label: 'Claude', pct: 0 }] }, 2) };
    const cards = providerCards(p, undefined);
    expect(cards.map((c) => c.key)).toEqual(['claude']);
    // As old as its oldest reading (Claude's, here).
    expect(cards[0]).toMatchObject({ plan: 'max', shape: 'quota', isDefault: true, updatedAt: 1 });
    expect(cards[0]?.windows.map((w) => `${w.source ?? ''}/${w.label} ${w.pct}`)).toEqual(['/Weekly 26', 'Antigravity/Gemini 2', 'Antigravity/Claude 0']);
    // Claude signed out says so on its own card, and Antigravity's stays apart.
    const out = { ...p, ...withUsage(p, CLAUDE_AGENT, { signedIn: false }, 3) };
    expect(providerCards(out, undefined).map((c) => c.key)).toEqual(['claude', 'antigravity']);
  });

  it('heads Antigravity’s windows by their group of models, each with its 5-hour and weekly limits', () => {
    const agy = { runtime: 'antigravity', label: 'Antigravity' };
    let p: Pick<Profile, 'usage' | 'usages' | 'agents'> = { agents: [CLAUDE_AGENT, agy] };
    p = { ...p, ...withUsage(p, CLAUDE_AGENT, { plan: 'max', week: { pct: 31 } }, 1) };
    p = { ...p, ...withUsage(p, agy, { windows: [{ group: 'Gemini Models', label: '5-hour', pct: 25 }, { group: 'Gemini Models', label: 'Weekly', pct: 8 }, { group: 'Claude and GPT models', label: '5-hour', pct: 0 }] }, 1) };
    const card = providerCards(p, undefined)[0]!;
    expect(card.windows.map((w) => [windowHeading(w) ?? '', w.label, w.short])).toEqual([
      ['', 'Weekly', 'wk'],
      ['Antigravity · Gemini Models', '5-hour', '5h'],
      ['Antigravity · Gemini Models', 'Weekly', 'wk'],
      ['Antigravity · Claude and GPT models', '5-hour', '5h'],
    ]);
    // A group's name rides through the profile a friend's Mac parses.
    expect(Profile.parse({ ...base, ...p }).usages?.[1]?.windows?.[0]?.group).toBe('Gemini Models');
  });

  it('keeps the default on the folded card when Antigravity is yours, and leaves old Antigravity numbers on their own card', () => {
    const agy = { runtime: 'antigravity', label: 'Antigravity' };
    let p: Pick<Profile, 'usage' | 'usages' | 'agents'> = { agents: [CLAUDE_AGENT, agy] };
    p = { ...p, ...withUsage(p, CLAUDE_AGENT, { plan: 'max', week: { pct: 26 } }, 1_000) };
    p = { ...p, ...withUsage(p, agy, { plan: 'Google AI Ultra', windows: [{ label: 'Gemini', pct: 2 }] }, 2_000) };
    // Antigravity is your default: the one card it's on says so.
    expect(providerCards(p, agy).map((c) => [c.key, c.isDefault])).toEqual([['claude', true]]);
    // The card is as old as its oldest reading.
    expect(providerCards(p, undefined)[0]?.updatedAt).toBe(1_000);
    // Claude read again much later, Antigravity not: its numbers aren't shown as Claude's fresh ones.
    const later = { ...p, ...withUsage(p, CLAUDE_AGENT, { plan: 'max', week: { pct: 27 } }, 2_000 + GUEST_STALE_MS + 1) };
    const cards = providerCards(later, undefined);
    expect(cards.map((c) => c.key)).toEqual(['claude', 'antigravity']);
    expect(cards[1]?.updatedAt).toBe(2_000);
  });

  it('shows whose agent has room left, across providers', () => {
    const mia = { ...base, name: 'mia', peerId: 'm', defaultAgent: codex, ...withUsage(withUsage({}, CLAUDE_AGENT, { fiveHour: { pct: 10 } }), codex, { fiveHour: { pct: 71 }, week: { pct: 46 } }) };
    const old = { ...base, name: 'bob', peerId: 'b', usage: { week: { pct: 80 }, updatedAt: 1 } };
    const me = { ...base, peerId: 'k', ...withUsage({}, CLAUDE_AGENT, { fiveHour: { pct: 1 } }) };
    const rooms = friendRooms([me, mia, old], 'k');
    expect(rooms.map((r) => `${r.name} ${r.agent.label} ${r.left}${r.isDefault ? ' default' : ''}`)).toEqual(['mia Codex 29 default', 'mia Claude 90', 'bob Claude 20 default']);
  });
});
