import { describe, expect, it } from 'vitest';
import { views } from '../../packages/studio-app/e2e/fixtures/views.js';
import { todosOf } from '../../packages/studio-app/lib/todo.js';

/** BLG-94: what a plan puts in the customer's to-do list, with the plan page's priority. */

describe('todosOf', () => {
  it('makes one card per open decision', () => {
    const todos = todosOf('p1', views.decide, 'zh');
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ kind: 'decision', planRef: 'plan1', decisionId: 'd-m0-t0' });
    expect(todos[0]?.sub).toContain('先做提醒还是先做统计');
    expect(todos[0]?.key).toBe('decision:plan1:d-m0-t0');
  });

  it('makes one review card with the milestone that needs approving', () => {
    const todos = todosOf('p1', views.review, 'zh');
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ kind: 'review', milestoneRef: 'm0', draftRev: 1 });
    expect(todos[0]?.sub).toContain('记录喝水');
  });

  it('makes one changes card with the counts', () => {
    const todos = todosOf('p1', views.changes, 'zh');
    expect(todos).toHaveLength(1);
    expect(todos[0]?.kind).toBe('changes');
    expect(todos[0]?.sub).toContain('+1');
    expect(todos[0]?.key).toBe('changes:plan1');
  });

  it('makes one confirm card while the plan waits for the customer', () => {
    const todos = todosOf('p1', views.confirm, 'zh');
    expect(todos).toHaveLength(1);
    expect(todos[0]?.kind).toBe('confirm');
    expect(todos[0]?.draftRev).toBe(2);
  });

  it('adds nothing while the studio, the AI or the end has it', () => {
    expect(todosOf('p1', views.running, 'zh')).toEqual([]);
    expect(todosOf('p1', views.draftingAi, 'zh')).toEqual([]);
    expect(todosOf('p1', views.awaitingStart, 'zh')).toEqual([]);
    expect(todosOf('p1', views.awaitingChanges, 'zh')).toEqual([]);
    expect(todosOf('p1', views.done, 'zh')).toEqual([]);
  });

  it('lets a decision outrank a review in the same plan', () => {
    const both = { ...views.review, decisions: views.decide.decisions } as typeof views.review;
    const todos = todosOf('p1', both, 'zh');
    expect(todos.map((todo) => todo.kind)).toEqual(['decision']);
  });
});
