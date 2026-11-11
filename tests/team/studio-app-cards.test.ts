import { describe, expect, it } from 'vitest';
import { cardFor } from '../../packages/studio-app/lib/cards';
import type { PlanSummary, ProjectSummary } from '../../packages/studio-app/lib/hub-schema';

/** BLG-84: what a project card shows, without a browser. */

const project: ProjectSummary = { id: 'p1', studioId: 's1', studioName: 'Acme', name: 'Water' };
const studio = { online: false, lastSyncAt: 1_768_000_000_000 };
const plan = (ref: string, patch: Partial<PlanSummary> = {}): PlanSummary => ({
  planRef: ref,
  title: ref,
  stage: 'running',
  waitingOn: 'studio',
  headline: ref + ' line',
  progress: { done: 1, total: 3 },
  updatedAt: 10,
  ...patch,
});

describe('the project card rules', () => {
  it('says no requests when there are none', () => {
    const card = cardFor(project, [], studio);
    expect(card.headline).toBeNull();
    expect(card.plansKnown).toBe(true);
    expect(card.waiting).toBe(false);
    expect(card.studio).toEqual(studio);
  });

  it('uses the newest plan and says so when one is waiting on the customer', () => {
    const card = cardFor(project, [plan('old', { updatedAt: 1 }), plan('new', { updatedAt: 9, waitingOn: 'customer' })], studio);
    expect(card.headline).toBe('new line');
    expect(card.waiting).toBe(true);
  });

  it('distinguishes a failed plans call from an empty one', () => {
    const card = cardFor(project, undefined, undefined);
    expect(card.plansKnown).toBe(false);
    expect(card.headline).toBeNull();
    expect(card.studio).toBeUndefined();

    const loading = cardFor(project, undefined, undefined, true);
    expect(loading.plansLoading).toBe(true);
  });

  it('ignores a blank headline', () => {
    expect(cardFor(project, [plan('p', { headline: '   ' })], studio).headline).toBeNull();
  });
});
