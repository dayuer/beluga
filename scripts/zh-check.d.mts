// Types for scripts/zh-check.mjs (used by tests/zh-check.test.ts).

type Catalog = Readonly<Record<string, string>>;

/** Upstream's zh-CN catalog before and after, against the fork's own zh-CN.fork.json. */
export function compareZh(input: { before: Catalog; after: Catalog; fork: Catalog }): {
  added: string[];
  changed: string[];
  removed: string[];
  overrides: string[];
  recheck: string[];
  gone: string[];
  redundant: string[];
};
