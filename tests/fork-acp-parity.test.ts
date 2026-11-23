import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLAUDE_CAPABILITIES } from '../src/agent/runtime/claude/index.js';
import { ACP_CAPABILITIES } from '../src/agent/runtime/acp-agents/spec.js';
import { ACP_FALLBACKS, ACP_MISSING } from '../src/shared/acp-fallbacks.js';

/**
 * docs/parity.fork.md's "Agent runs on ACP agents" table against the code (BLG-ACP), by the rules
 * tests/parity.test.ts holds upstream's runtimes to: no blank cell, the fallbacks and missing
 * features the table names are the code's, each fallback shown somewhere, and every capability an
 * ACP agent lacks accounted for.
 */
const doc = readFileSync('docs/parity.fork.md', 'utf8');
const start = doc.indexOf('## Agent runs on ACP agents (fork)');
const end = doc.indexOf('\n## ', start + 1);
const text = doc.slice(start, end === -1 ? undefined : end);
const lines = text.split('\n').filter((l) => l.startsWith('|'));
const cells = (l: string): string[] => l.slice(1, l.endsWith('|') ? -1 : undefined).split(' | ').map((c) => c.trim());
const header = cells(lines[0]!);
const rows = lines.slice(2).map(cells);
const upstream = readFileSync('docs/parity.md', 'utf8');
const upstreamRows = (() => {
  const s = upstream.indexOf('## Agent runs, per runtime');
  return upstream.slice(s, upstream.indexOf('\n## ', s + 1)).split('\n').filter((l) => l.startsWith('| ')).slice(1).map((l) => cells(l)[0]!);
})();

describe('docs/parity.fork.md, ACP agents', () => {
  it('has the table, a row for each of upstream’s, and no blank cell', () => {
    expect(header).toEqual(['What', 'Ways in', 'ACP agents']);
    expect(rows.map((r) => r[0])).toEqual(upstreamRows.filter((r) => r !== 'What'));
    expect(rows.filter((r) => r.length !== 3 || !/^(pass|fallback|n\/a)\b/.test(r[2] ?? '')).map((r) => r[0])).toEqual([]);
  });

  it('names a fallback for every row that is one, and only the ones the code has', () => {
    const named = rows.filter((r) => r[2]!.startsWith('fallback')).map((r) => /`fallback:([a-z_]+)`/.exec(r[2]!)?.[1] ?? `(none in "${r[0]}")`);
    expect([...named].sort()).toEqual(Object.keys(ACP_FALLBACKS).sort());
  });

  it('names every feature an ACP agent lacks, and only those', () => {
    const named = rows.flatMap((r) => [...r[2]!.matchAll(/`missing:([a-z_]+)`/g)].map((m) => m[1]!));
    expect([...named].sort()).toEqual([...ACP_MISSING].sort());
  });

  it('shows every fallback somewhere', () => {
    const files = execFileSync('git', ['ls-files', 'src/*.ts', 'packages/mac/src/*.ts', 'packages/mac/src/*.tsx', 'packages/companion/app/*.tsx'], { encoding: 'utf8' }).split('\n').filter((f) => f && f !== 'src/shared/runtime-fallbacks.ts' && f !== 'src/shared/acp-fallbacks.ts');
    const shown = new Set(files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/fallbackFor\([^;]*?'([a-z_]+)'\)/g)].map((m) => m[1]!)));
    expect(Object.keys(ACP_FALLBACKS).filter((id) => !shown.has(id))).toEqual([]);
  });

  it('accounts for every capability an ACP agent lacks, and every fallback stands for one it does lack', () => {
    const caps = ACP_CAPABILITIES as unknown as Record<string, unknown>;
    const lacking = Object.keys(caps).filter((k) => caps[k] === false && k !== 'hasSandbox');
    expect(lacking.filter((k) => !upstream.includes(`\`${k}\``) && !text.includes(`\`${k}\``))).toEqual([]);
    const claimed = Object.values(ACP_FALLBACKS).flatMap((f) => (f?.capability ? [f.capability] : []));
    expect(claimed.filter((k) => caps[k] === (CLAUDE_CAPABILITIES as unknown as Record<string, unknown>)[k])).toEqual([]);
  });
});
