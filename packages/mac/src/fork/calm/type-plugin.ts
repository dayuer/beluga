import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { rewriteGlow, skipGlowFile } from './glow-scan.js';
import { REMAINING_LIMIT, type TypeReport, rewriteType, skipFile, summarize } from './type-scale.js';

/**
 * Build-time (and dev-time) rewrite of the mac CSS onto the calm type scale (M8, BLG-244;
 * docs/calm/finish.md §3) and onto the calm glow tokens (BLG-256, §4; glow-scan.ts). Only the values type-scale.ts plans are touched, and each becomes
 * `var(--calm-fs-N, <original>)`, so with calm off the page draws what upstream wrote. A failure
 * in one file returns that file's code unchanged: it must never break the build.
 *
 * buildEnd prints the counts and the exceptions, and writes .context/calm/type-report.json.
 */

const SRC = path.join('packages', 'mac', 'src') + path.sep;

export function calmType(): Plugin {
  const seen = new Map<string, ReturnType<typeof rewriteType>>();
  const glows = new Map<string, { rings: number; glows: number; kept: string[] }>();
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
      let next = code;
      try {
        if (!skipFile(rel)) {
          const out = rewriteType(next, rel);
          seen.set(rel, out);
          next = out.code;
        }
        if (!skipGlowFile(rel)) {
          const g = rewriteGlow(next);
          if (g.rings || g.glows || g.kept.length) glows.set(rel, { rings: g.rings, glows: g.glows, kept: g.kept });
          next = g.code;
        }
      } catch (err) {
        console.warn(`calm-type: ${rel} left as it is (${(err as Error).message})`);
        return null;
      }
      return next === code ? null : { code: next, map: null };
    },
    buildEnd() {
      try {
        // The same summary tests/fork-calm-type.test.ts prints: one definition of "spellings left".
        const report: TypeReport = summarize([...seen.values()]);
        const rings = [...glows.values()].reduce((n, g) => n + g.rings, 0);
        const off = [...glows.values()].reduce((n, g) => n + g.glows, 0);
        const kept = [...glows.entries()].flatMap(([f, g]) => g.kept.map((k) => `${f}: ${k}`));
        console.log(`calm-type: ${report.decls} decls, spellings ${report.spellingsBefore}→${report.spellingsAfter} (tokens ${report.tokens}, kept ${report.kept.length}), mapped ${report.mapped}; remaining against the limit of ${REMAINING_LIMIT}: ${report.remaining}; exceptions:`);
        for (const k of report.kept) console.log(`  ${k.prop}  ${k.value}  (${k.why}; ${k.files.length} file${k.files.length === 1 ? '' : 's'})`);
        if (report.unjustified.length) console.warn(`calm-type: ${report.unjustified.length} kept value(s) on no exception list: ${report.unjustified.join('; ')}`);
        console.log(`calm-glow: ${rings} halo spreads on --calm-ring, ${off} blurred glows on --calm-glow-off in ${glows.size} files; kept on purpose: ${kept.length}${kept.length ? ` (${kept.join('; ')})` : ''}`);
        const dir = path.join(repoRoot, '.context', 'calm');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'type-report.json'), `${JSON.stringify({ ...report, glow: { rings, blurred: off, files: glows.size, kept } }, null, 2)}\n`);
      } catch (err) {
        console.warn(`calm-type: report not written (${(err as Error).message})`);
      }
    },
  };
}
