/**
 * How deep each milestone sits in what it waits on: the columns of the plan map. A Mac before
 * 1.5 sends no `dependsOn`: its milestones run one after another. Moved unchanged from the
 * companion's PlanParts so both apps draw the same chain.
 */
export interface LevelItem {
  readonly id: string;
  readonly dependsOn?: readonly string[];
}

export function milestoneLevels(items: readonly LevelItem[]): number[] {
  const index = new Map(items.map((m, i) => [m.id, i]));
  const memo = new Map<number, number>();
  const depth = (i: number, seen: ReadonlySet<number>): number => {
    const known = memo.get(i);
    if (known !== undefined) return known;
    const m = items[i]!;
    const deps =
      m.dependsOn === undefined
        ? i > 0
          ? [i - 1]
          : []
        : m.dependsOn.map((d) => index.get(d)).filter((d): d is number => d !== undefined && !seen.has(d));
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depth(x, new Set([...seen, i])))) : 0;
    memo.set(i, d);
    return d;
  };
  return items.map((_, i) => depth(i, new Set([i])));
}
