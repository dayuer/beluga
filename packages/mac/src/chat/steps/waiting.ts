import type { TaskView } from '@beluga/core/gateway/model.js';
import { isFinal } from '@beluga/core/gateway/model.js';
import { humanizeLine } from '@beluga/shared/step-titles.js';
import { t as tr } from '../../i18n/index.js';

/**
 * What Claude is waiting on when it asked someone else's Claude (or Mac), in words, from the
 * task's live state: "bob is approving…", "bob's Claude is working · Reading payments.ts".
 */

const target = (t: Pick<TaskView, 'peerName' | 'kind'>): string => tr(t.kind === 'ask' ? 'chat.waiting.theirAgent' : 'chat.waiting.theirComputer', { name: t.peerName });

/** The waiting row's heading. */
export const waitingFor = (t: TaskView | undefined): string => (t ? tr('chat.waiting.waitingFor', { target: target(t) }) : tr('chat.waiting.waitingAnswer'));

/** Where the task is right now, as one line. */
export function waitState(t: TaskView): string {
  const them = t.peerName;
  if (t.question) return tr('chat.waiting.asks', { name: them, question: t.question.questions[0]?.question ?? tr('chat.waiting.aQuestion') });
  switch (t.state) {
    case 'confirm':
      return tr('chat.waiting.confirm', { name: them });
    case 'sent':
      return tr('chat.waiting.sent', { name: them });
    case 'queued':
      return tr('chat.waiting.queued', { name: them });
    case 'awaiting_approval':
      return tr('chat.waiting.approving', { name: them });
    case 'working': {
      if (t.incoming) return tr('chat.waiting.receiving', { name: them });
      if (t.kind === 'run') return tr('chat.waiting.running', { name: them });
      if (t.kind === 'file') return tr('chat.waiting.sendingFile', { name: them });
      const last = t.steps.at(-1);
      return last ? tr('chat.waiting.workingOn', { name: them, doing: humanizeLine(last).doing }) : tr('chat.waiting.working', { name: them });
    }
    case 'done':
      return tr('chat.waiting.answered', { target: target(t) });
    case 'declined':
      return tr('chat.waiting.declined', { name: them });
    case 'failed':
      return tr('chat.waiting.failed');
    case 'cancelled':
      return tr('chat.waiting.cancelled');
  }
}

/** How a finished wait reads in the list of steps. */
export function waitedLabel(t: TaskView | undefined): string | undefined {
  if (!t || !isFinal(t.state)) return undefined;
  if (t.state === 'done') return tr(t.kind === 'ask' ? 'chat.waiting.heardBack' : 'chat.waiting.gotResult', { name: t.peerName });
  if (t.state === 'declined') return tr('chat.waiting.declined', { name: t.peerName });
  return tr(t.state === 'cancelled' ? 'chat.waiting.stoppedWaiting' : 'chat.waiting.couldnt', { target: target(t) });
}

export const waitTone = (t: TaskView | undefined): 'claude' | 'warn' | 'ok' | 'error' =>
  !t ? 'claude' : t.question || t.state === 'awaiting_approval' || t.state === 'confirm' ? 'warn' : t.state === 'done' ? 'ok' : t.state === 'failed' || t.state === 'declined' ? 'error' : 'claude';
