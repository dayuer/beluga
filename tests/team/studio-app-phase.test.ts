import { describe, expect, it } from 'vitest';
import type { StudioMilestone, StudioPlanView } from '../../src/studio/protocol';
import { applyLocal, hasPrimary, localFor, pagePhase, type LocalPlanState } from '../../packages/studio-app/lib/plan-phase';

/** BLG-91: the plan page's one phase, and therefore its one primary action. */

const milestone = (patch: Partial<StudioMilestone> = {}): StudioMilestone => ({
  ref: 'm1',
  title: '登录',
  criteria: [],
  status: 'working',
  tasks: [],
  ...patch,
});

const view = (patch: Partial<StudioPlanView> = {}): StudioPlanView =>
  ({
    planRef: 'p1',
    draftRev: 3,
    title: '饮水 App',
    goal: '记录每天的喝水',
    stage: 'running',
    waitingOn: 'ai',
    headline: '在做：登录',
    progress: { done: 0, total: 1 },
    milestones: [milestone()],
    decisions: [],
    turns: [],
    typing: false,
    moreTurns: false,
    activity: [],
    ...patch,
  }) as StudioPlanView;

const openDecision = {
  decisionId: 'd-m0-t0',
  question: '先做 iOS 吗？',
  options: [{ id: 'o0', label: '先做 iOS' }, { id: 'o1', label: '两个一起' }],
  multi: false,
  open: true,
};

describe('pagePhase', () => {
  it('covers every phase', () => {
    expect(pagePhase(view({ decisions: [openDecision], waitingOn: 'customer' }))).toBe('decide');
    expect(pagePhase(view({ milestones: [milestone({ status: 'review' })] }))).toBe('review');
    expect(pagePhase(view({ draftDiff: { draftRev: 3, added: [], changed: [], removed: [] } }))).toBe('changes');
    expect(pagePhase(view({ stage: 'drafting', milestones: [milestone({ status: 'planned' })] }))).toBe('confirm');
    expect(pagePhase(view({ stage: 'drafting', gate: { kind: 'start', state: 'pending', draftRev: 3 }, waitingOn: 'studio' }))).toBe('awaiting-start');
    expect(
      pagePhase(view({ draftDiff: { draftRev: 3, added: [], changed: [], removed: [] }, gate: { kind: 'changes', state: 'pending', draftRev: 3 }, waitingOn: 'studio' })),
    ).toBe('awaiting-changes');
    expect(pagePhase(view({ stage: 'drafting', milestones: [], waitingOn: 'ai' }))).toBe('drafting-ai');
    expect(pagePhase(view({ typing: true, stage: 'drafting', milestones: [] }))).toBe('drafting-ai');
    expect(pagePhase(view({ stage: 'done', waitingOn: 'studio' }))).toBe('done');
    expect(pagePhase(view({ stage: 'running' }))).toBe('running');
  });

  it('uses the documented priority', () => {
    expect(pagePhase(view({ decisions: [openDecision], milestones: [milestone({ status: 'review' })] }))).toBe('decide');
    expect(pagePhase(view({ milestones: [milestone({ status: 'review' })], draftDiff: { draftRev: 3, added: [], changed: [], removed: [] } }))).toBe('review');
    expect(
      pagePhase(
        view({ stage: 'drafting', milestones: [milestone({ status: 'planned' })], draftDiff: { draftRev: 3, added: [], changed: [], removed: [] } }),
      ),
    ).toBe('changes');
  });

  it('falls back to running when awaiting-review has no review milestone (the daemon is switching)', () => {
    expect(pagePhase(view({ stage: 'awaiting-review', milestones: [milestone({ status: 'checking' })] }))).toBe('running');
  });

  it('gives a primary only to the four phases that wait on the customer', () => {
    expect(hasPrimary('decide')).toBe(true);
    expect(hasPrimary('review')).toBe(true);
    expect(hasPrimary('changes')).toBe(true);
    expect(hasPrimary('confirm')).toBe(true);
    expect(hasPrimary('awaiting-start')).toBe(false);
    expect(hasPrimary('awaiting-changes')).toBe(false);
    expect(hasPrimary('drafting-ai')).toBe(false);
    expect(hasPrimary('running')).toBe(false);
    expect(hasPrimary('done')).toBe(false);
  });
});

describe('the local patch between a receipt and the next frame', () => {
  const confirm = view({ stage: 'drafting', milestones: [milestone({ status: 'planned' })] });
  const changes = view({ draftDiff: { draftRev: 3, added: [], changed: [], removed: [] } });
  const review = view({ milestones: [milestone({ status: 'review' })] });
  const decide = view({ decisions: [openDecision] });
  const local = (patch: Partial<LocalPlanState>): LocalPlanState => ({ rev: 3, ...patch });

  it('turns a confirmed plan into awaiting the studio', () => {
    expect(pagePhase(confirm, local({ confirm: true }))).toBe('awaiting-start');
  });

  it('turns an applied draft into awaiting the studio for the change', () => {
    expect(pagePhase(changes, local({ applied: true }))).toBe('awaiting-changes');
  });

  it('removes a passed or sent-back milestone from review', () => {
    expect(pagePhase(review, local({ passedMilestoneRef: 'm1' }))).toBe('running');
    expect(pagePhase(review, local({ sentBackMilestoneRef: 'm1' }))).toBe('running');
  });

  it('takes an answered decision out of the question', () => {
    expect(pagePhase(decide, local({ answered: ['d-m0-t0'] }))).toBe('running');
    expect(pagePhase(decide, local({ answered: ['someone-else'] }))).toBe('decide');
  });

  it('drops the patch as soon as a newer frame arrives', () => {
    expect(localFor(3, local({ confirm: true }))).toBeDefined();
    expect(localFor(4, local({ confirm: true }))).toBeUndefined();
  });

  it('never mutates the view it was given', () => {
    const before = JSON.stringify(decide);
    const patched = applyLocal(decide, local({ answered: ['d-m0-t0'] }));
    expect(patched.decisions[0]?.open).toBe(false);
    expect(decide.decisions[0]?.open).toBe(true);
    expect(JSON.stringify(decide)).toBe(before);
  });
});
