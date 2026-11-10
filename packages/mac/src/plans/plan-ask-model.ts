import type { PendingQuestion } from '../../../../src/core/collab-store.js';

/** How a multi-select's picks so far are kept on the question (see src/ui/collab-actions.ts). */
const MULTI = '#multi';
const SEP = '\u0000';

/** The options picked so far on one question of a card (a multi-select's ticks). */
export function chosenOf(q: Pick<PendingQuestion, 'picked'>, question: string): ReadonlySet<string> {
  return new Set((q.picked[`${question}${MULTI}`] ?? '').split(SEP).filter(Boolean));
}

/**
 * The question the plan's conversation answers right there: the one you just asked to decide
 * (`wanted`, its card's qid), else the first decision asked in it, else its first question.
 */
export function planAskOf(questions: readonly PendingQuestion[], channel: string, wanted?: string): PendingQuestion | undefined {
  const here = questions.filter((q) => q.channel === channel && q.question.kind === 'question');
  return (wanted ? here.find((q) => q.qid === wanted) : undefined) ?? here.find((q) => q.qid.startsWith('decide:')) ?? here[0];
}

/** "Decide…" on a task of yours (the canvas, the outline, its details): the plan's page opens its conversation, where the card asks you. */
export const OPEN_DECISION = 'beluga:plan-open-decision';

export const openDecision = (planId: string, taskId: string): void => void document.dispatchEvent(new CustomEvent<DecisionWanted>(OPEN_DECISION, { detail: { planId, taskId } }));

/** Which task's Decide… was pressed last. */
export interface DecisionWanted {
  readonly planId: string;
  readonly taskId: string;
}

// The card the conversation shows and scrolls to: the one asked for last (the chat may mount after the press).
let wanted: { readonly qid: string; readonly at: number } | undefined;
const heard = new Set<() => void>();
export const wantDecision = (qid: string): void => {
  wanted = { qid, at: Date.now() };
  for (const l of heard) l();
};
export const wantedDecision = (): { readonly qid: string; readonly at: number } | undefined => wanted;
export const onWantedDecision = (l: () => void): (() => void) => (heard.add(l), () => void heard.delete(l));
