import { describe, expect, it } from 'vitest';
import type { PendingQuestion } from '../src/core/collab-store.js';
import { decisionQid } from '../src/core/plans/decisions.js';

// Through a variable: the root typecheck can't follow the Mac app's @beluga paths (its own tsc checks the file).
const MODULE = '../packages/mac/src/plans/plan-ask-model.js';
type Model = {
  planAskOf: (q: readonly PendingQuestion[], channel: string, wanted?: string) => PendingQuestion | undefined;
  wantDecision: (qid: string) => void;
  wantedDecision: () => { qid: string; at: number } | undefined;
  onWantedDecision: (l: () => void) => () => void;
};
const model = async (): Promise<Model> => (await import(MODULE)) as Model;

const card = (qid: string, channel = 'ws:home'): PendingQuestion => ({ qid, channel, question: { kind: 'question', questions: [] }, picked: {} }) as unknown as PendingQuestion;

describe('Decide… on a task of yours shows that task’s card', () => {
  const first = card(decisionQid('pl_1', 'decide-hosting'));
  const second = card(decisionQid('pl_1', 'decide-git'));

  it('the card of the task asked about, not the first one asked', async () => {
    const { planAskOf } = await model();
    expect(planAskOf([first, second], 'ws:home')).toBe(first);
    expect(planAskOf([first, second], 'ws:home', second.qid)).toBe(second);
    // A wanted card that isn't there (not its turn yet): the conversation still shows what it has.
    expect(planAskOf([first], 'ws:home', second.qid)).toBe(first);
    expect(planAskOf([second], 'ws:other', second.qid)).toBeUndefined();
  });

  it('each press is heard, the same task twice too (so the card scrolls into view again)', async () => {
    const { wantDecision, wantedDecision, onWantedDecision } = await model();
    let heard = 0;
    const stop = onWantedDecision(() => void heard++);
    wantDecision(second.qid);
    const once = wantedDecision();
    wantDecision(second.qid);
    expect(heard).toBe(2);
    expect(wantedDecision()?.qid).toBe(second.qid);
    expect(wantedDecision()).not.toBe(once);
    stop();
    wantDecision(first.qid);
    expect(heard).toBe(2);
  });
});
