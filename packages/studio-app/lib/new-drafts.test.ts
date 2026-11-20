import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();

vi.mock('./kv', () => ({
  kv: {
    get: <T,>(k: string) => store.get(k) as T | undefined,
    set: (k: string, v: unknown) => {
      store.set(k, v);
    },
    remove: (k: string) => {
      store.delete(k);
    },
  },
}));

import {
  clearFeedbackModeDraft,
  clearNewModeDraft,
  restoreBothDrafts,
  writeFeedbackModeDraft,
  writeNewModeDraft,
} from './new-drafts';

describe('lib/new-drafts', () => {
  beforeEach(() => {
    store.clear();
  });

  it('restores both new and feedback drafts independently without overwriting each other', () => {
    writeNewModeDraft('proj-1', {
      goal: '做个喝水提醒',
      platforms: ['ios'],
      attachments: [],
      updatedAt: 1_000,
    });
    writeFeedbackModeDraft('proj-1', {
      requestId: 'req-done-1',
      text: '圆角再大一点',
      attachments: [],
      updatedAt: 2_000,
    });

    const restored = restoreBothDrafts('proj-1');
    expect(restored.newDraft?.goal).toBe('做个喝水提醒');
    expect(restored.newDraft?.platforms).toEqual(['ios']);
    expect(restored.feedbackDraft?.requestId).toBe('req-done-1');
    expect(restored.feedbackDraft?.text).toBe('圆角再大一点');
  });

  it('persists and restores attachments alongside both drafts', () => {
    const imgA = { id: 'a1', uri: 'file:///a.jpg', width: 1024, height: 768, fileName: 'a.jpg' };
    const imgB = { id: 'b1', uri: 'file:///b.jpg', width: 800, height: 600, fileName: 'b.jpg' };

    writeNewModeDraft('proj-1', {
      goal: '',
      platforms: [],
      attachments: [imgA],
      updatedAt: 1_000,
    });
    writeFeedbackModeDraft('proj-1', {
      requestId: 'req-done-1',
      text: '',
      attachments: [imgB],
      updatedAt: 2_000,
    });

    const restored = restoreBothDrafts('proj-1');
    expect(restored.newDraft?.attachments).toEqual([imgA]);
    expect(restored.feedbackDraft?.attachments).toEqual([imgB]);

    clearNewModeDraft('proj-1');
    expect(restoreBothDrafts('proj-1').feedbackDraft?.attachments).toEqual([imgB]);
    clearFeedbackModeDraft('proj-1');
    expect(restoreBothDrafts('proj-1').feedbackDraft).toBeUndefined();
  });
});
