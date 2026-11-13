// Types for scripts/sync-upstream.mjs (used by the tests).

export interface SyncArgs {
  report: boolean;
  afterMerge: boolean;
  remote: string;
  ref: string;
}

export interface SelectorUse {
  kind: 'class' | 'data' | 'aria';
  /** The class name as written, the data attribute (`data-step`), or the aria literal (`Your card`). */
  name: string;
  selector: string;
  files: string[];
}

export interface CalmSummaryInput {
  risk?: readonly string[];
  calmRisk?: readonly string[];
  newFindings?: readonly (string | { at: string; key: string })[];
  goneFindings?: readonly string[];
  stale?: readonly SelectorUse[];
}

export const UPSTREAM_URL: string;
export const VERSION_FILES: readonly string[];
export const CALM_SUMMARY_MARKER: string;
export const THIRD_PARTY_CLASSES: readonly string[];
export function compareVersions(a: string, b: string): -1 | 0 | 1;
export function versionOf(text: string): string | undefined;
export function withVersion(text: string, version: string): string;
export function onlyVersionChanged(base: string | undefined, ours: string | undefined): boolean;
export function blocking(names: string): string[];
export function unexplained(touched: readonly string[], doc: string): string[];
export function parseArgs(argv: readonly string[]): SyncArgs;
export function bothChanged(forkTouched: readonly string[], upstreamChanged: readonly string[]): string[];
export function calmFiles(doc: string): Set<string>;
export function selectorsIn(calmCss: readonly { file: string; text: string }[]): SelectorUse[];
export function staleSelectors(uses: readonly SelectorUse[], sources: readonly { file: string; text: string }[]): SelectorUse[];
export function calmSummary(input?: CalmSummaryInput): string;
export function withCalmSummary(message: string, summary: string): string;
export function forkCalmFindings(text: string): { added: { at: string; key: string }[]; gone: string[] };
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
