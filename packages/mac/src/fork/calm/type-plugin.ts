import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { type TypeReport, rewriteType, skipFile } from './type-scale.js';

/**
 * Build-time (and dev-time) rewrite of the mac CSS onto the calm type scale (M8, BLG-244;
 * docs/calm/finish.md §3). Only the values type-scale.ts plans are touched, and each becomes
 * `var(--calm-fs-N, <original>)`, so with calm off the page draws what upstream wrote. A failure
 * in one file returns that file's code unchanged: it must never break the build.
 *
 * buildEnd prints the counts and the exceptions, and writes .context/calm/type-report.json.
 */

const SRC = path.join('packages', 'mac', 'src') + path.sep;

export function calmType(): Plugin {
  const seen = new Map<string, { decls: number; mapped: number; kept: TypeReport['kept']; before: string[]; tokens: string[] }>();
  let repoRoot = process.cwd();
  return {
    name: 'beluga-calm-type',
    enforce: 'pre',
    configResolved(config) {
      repoRoot = path.resolve(config.root, '../..');
    },
    transform(code, id) {
      const clean = id.split('?')[0]!;
      if (!clean.endsWith('.css') || !clean.includes(SRC)) return null;
      const rel = clean.slice(clean.indexOf(SRC) + SRC.length).split(path.sep).join('/');
      if (skipFile(rel)) return null;
      try {
        const out = rewriteType(code, rel);
        const before = [...code.matchAll(/font-(size|weight)\s*:\s*([^;{}]+?)\s*(?:!important)?\s*(?=[;}])/g)].map((m) => `${m[1]} ${m[2]!.trim()}`);
        const tokens = [...out.code.matchAll(/var\((--calm-f[sw]-[\w]+),/g)].map((m) => m[1]!);
        seen.set(rel, { decls: before.length, mapped: out.mapped, kept: out.kept, before, tokens });
        return out.mapped ? { code: out.code, map: null } : null;
      } catch (err) {
        console.warn(`calm-type: ${rel} left as it is (${(err as Error).message})`);
        return null;
      }
    },
    buildEnd() {
      try {
        let decls = 0;
        let mapped = 0;
        const before = new Set<string>();
        const tokens = new Set<string>();
        const kept = new Map<string, TypeReport['kept'][number]>();
        for (const f of seen.values()) {
          decls += f.decls;
          mapped += f.mapped;
          for (const b of f.before) before.add(b);
          for (const t of f.tokens) tokens.add(t);
          for (const k of f.kept) {
            const key = `${k.prop} ${k.value}`;
            const hit = kept.get(key);
            if (hit) hit.files.push(...k.files);
            else kept.set(key, { ...k, files: [...k.files] });
          }
        }
        const report: TypeReport = {
          decls,
          spellingsBefore: before.size,
          mapped,
          kept: [...kept.values()],
          spellingsAfter: kept.size + tokens.size,
        };
        console.log(`calm-type: ${decls} decls, spellings ${before.size}→${kept.size + tokens.size} (kept ${kept.size}, tokens ${tokens.size}), mapped ${mapped}; exceptions:`);
        for (const k of report.kept) console.log(`  ${k.prop}  ${k.value}  (${k.why}; ${k.files.length} file${k.files.length === 1 ? '' : 's'})`);
        const dir = path.join(repoRoot, '.context', 'calm');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'type-report.json'), `${JSON.stringify(report, null, 2)}\n`);
      } catch (err) {
        console.warn(`calm-type: report not written (${(err as Error).message})`);
      }
    },
  };
}
