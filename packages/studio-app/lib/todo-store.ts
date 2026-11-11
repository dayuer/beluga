import { useCallback, useEffect, useRef, useState } from 'react';
import { cache } from './cache';
import { hub } from './client';
import type { PlanSummary } from './hub-schema';
import { detectLang } from './strings';
import { todosOf, type Todo } from './todo';

export interface TodoCard extends Todo {
  readonly projectName: string;
  readonly updatedAt: number;
}

export interface TodosResult {
  readonly todos: readonly TodoCard[];
  readonly byProject: Readonly<Record<string, number>>;
  readonly fetchedAt: number;
  readonly failed: number;
}

const KIND_ORDER: Record<Todo['kind'], number> = { decision: 0, review: 1, changes: 2, confirm: 3 };

/** Four views at a time: enough to feel quick, few enough for a phone on a train. */
async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await run(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

let lastResult: TodosResult | undefined;
let inflight: Promise<TodosResult> | null = null;

async function run(): Promise<TodosResult> {
  const projects = await hub.projects();
  if (!projects.ok) throw new Error(projects.error.kind);
  const names = new Map(projects.value.projects.map((project) => [project.id, project.name]));

  const entries: { pid: string; summary: PlanSummary }[] = [];
  for (const project of projects.value.projects) {
    const plans = await hub.plans(project.id);
    if (!plans.ok) continue;
    for (const summary of plans.value.plans) if (summary.stage !== 'done') entries.push({ pid: project.id, summary });
  }

  const results = await mapLimit(entries.slice(0, 30), 4, async ({ pid, summary }) => {
    const answer = await hub.plan(pid, summary.planRef);
    if (!answer.ok) return { failed: 1, todos: [] as TodoCard[] };
    const todos = todosOf(pid, answer.value.view, detectLang()).map((todo) => ({
      ...todo,
      projectName: names.get(pid) ?? '',
      updatedAt: summary.updatedAt,
    }));
    return { failed: 0, todos };
  });

  const todos = results
    .flatMap((result) => result.todos)
    .sort((a, b) => b.updatedAt - a.updatedAt || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const byProject: Record<string, number> = {};
  for (const todo of todos) byProject[todo.pid] = (byProject[todo.pid] ?? 0) + 1;

  const result: TodosResult = { todos, byProject, fetchedAt: Date.now(), failed: results.reduce((n, r) => n + r.failed, 0) };
  lastResult = result;
  cache.set('todos', result, result.fetchedAt);
  return result;
}

/** The aggregation, cached 60 seconds and shared by the home screen and the to-do screen. */
export async function fetchTodos(force = false): Promise<TodosResult> {
  if (!force && lastResult && Date.now() - lastResult.fetchedAt < 60_000) return lastResult;
  if (inflight) return inflight;
  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

export interface TodosStore {
  readonly result: TodosResult | undefined;
  readonly loading: boolean;
  readonly error: 'offline' | 'error' | null;
  readonly refresh: () => Promise<void>;
}

export function useTodos(): TodosStore {
  const cached = cache.get<TodosResult>('todos')?.value ?? lastResult;
  const [result, setResult] = useState<TodosResult | undefined>(cached);
  const [loading, setLoading] = useState(cached === undefined);
  const [error, setError] = useState<'offline' | 'error' | null>(null);
  const resultRef = useRef(result);
  resultRef.current = result;

  const refresh = useCallback(async () => {
    setLoading(resultRef.current === undefined);
    try {
      const next = await fetchTodos(true);
      setResult(next);
      setError(null);
    } catch {
      if (resultRef.current === undefined) setError('error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (resultRef.current) return;
    setLoading(true);
    void fetchTodos(false)
      .then((next) => {
        setResult(next);
        setError(null);
      })
      .catch(() => {
        if (resultRef.current === undefined) setError('error');
      })
      .finally(() => setLoading(false));
  }, []);

  return { result, loading, error, refresh };
}
