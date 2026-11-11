// Types for scripts/sync-upstream.mjs (used by the tests).

export const UPSTREAM_URL: string;
export const VERSION_FILES: readonly string[];
export function compareVersions(a: string, b: string): -1 | 0 | 1;
export function versionOf(text: string): string | undefined;
export function withVersion(text: string, version: string): string;
export function onlyVersionChanged(base: string | undefined, ours: string | undefined): boolean;
export function blocking(names: string): string[];
export function unexplained(touched: readonly string[], doc: string): string[];
