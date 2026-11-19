import { describe, expect, it } from 'vitest';
import { cardFor } from './cards';
import type { PlanSummary, ProjectSummary, StudioStatus } from './hub-schema';

const project: ProjectSummary = {
  id: 'proj-1',
  studioId: 'studio-1',
  studioName: 'Synon 工作室',
  name: '饮水提醒 App',
};

const makePlan = (overrides: Partial<PlanSummary>): PlanSummary => ({
  planRef: 'plan-1',
  title: '默认计划',
  stage: 'drafting',
  waitingOn: 'ai',
  headline: '正在整理需求',
  progress: { done: 0, total: 3 },
  updatedAt: 1000,
  ...overrides,
});

describe('cardFor', () => {
  it('handles missing plans with loading flag', () => {
    const idle = cardFor(project, undefined, undefined, false);
    expect(idle.plansKnown).toBe(false);
    expect(idle.plansLoading).toBe(false);
    expect(idle.headline).toBeNull();
    expect(idle.waiting).toBe(false);

    const loading = cardFor(project, undefined, undefined, true);
    expect(loading.plansKnown).toBe(false);
    expect(loading.plansLoading).toBe(true);
  });

  it('picks the latest plan headline and detects customer waiting', () => {
    const studio: StudioStatus = { online: true, lastSyncAt: 2000 };
    const plans: PlanSummary[] = [
      makePlan({ planRef: 'p1', updatedAt: 1000, headline: '较早的进度', waitingOn: 'customer' }),
      makePlan({ planRef: 'p2', updatedAt: 3000, headline: '最新的进度', waitingOn: 'studio' }),
    ];

    const card = cardFor(project, plans, studio);
    expect(card.plansKnown).toBe(true);
    expect(card.plansLoading).toBe(false);
    expect(card.headline).toBe('最新的进度');
    expect(card.waiting).toBe(true);
    expect(card.studio).toEqual(studio);
  });

  it('returns null headline when latest headline is whitespace only', () => {
    const card = cardFor(project, [makePlan({ headline: '   ' })], undefined);
    expect(card.headline).toBeNull();
    expect(card.plansKnown).toBe(true);
  });
});
