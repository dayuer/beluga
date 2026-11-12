// Types for scripts/sync-upstream.mjs (used by the tests).

export const UPSTREAM_URL: string;
export const VERSION_FILES: readonly string[];
export function compareVersions(a: string, b: string): -1 | 0 | 1;
export function versionOf(text: string): string | undefined;
export function withVersion(text: string, version: string): string;
export function onlyVersionChanged(base: string | undefined, ours: string | undefined): boolean;
export function blocking(names: string): string[];
export function unexplained(touched: readonly string[], doc: string): string[];
/** One row of `git diff --numstat`: lines added and removed, and its changed lines (the larger of the two). */
export interface NumstatRow {
  readonly file: string;
  readonly add: number;
  readonly del: number;
  readonly lines: number;
}
export function parseNumstat(text: string): NumstatRow[];
export function reportLines(touched: readonly string[], stats: readonly NumstatRow[], missing: readonly string[]): string[];
export function stale(touched: readonly string[], doc: string, upstreamFiles: ReadonlySet<string>): string[];
