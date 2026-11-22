import { LIMITS, PLATFORMS, type StudioPlatform } from '../../../src/studio/protocol';
import { clearDraft, readDraft, writeDraft } from './drafts';
import { kv } from './kv';
import type { MediaAttachment } from './media';

export interface FeedbackDraft {
  readonly requestId: string;
  readonly text: string;
  readonly attachments: readonly MediaAttachment[];
  readonly updatedAt: number;
}

export interface NewModeDraft {
  readonly goal: string;
  readonly platforms: StudioPlatform[];
  readonly attachments: readonly MediaAttachment[];
  readonly updatedAt: number;
}

const feedbackDraftKey = (pid: string): string => `draft:feedback:${pid}`;
const newAttachmentsKey = (pid: string): string => `draft:new:attach:${pid}`;

const isAttachment = (v: unknown): v is MediaAttachment => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<MediaAttachment>;
  return typeof o.id === 'string' && typeof o.uri === 'string' && typeof o.width === 'number' && typeof o.height === 'number';
};

const sanitizeAttachments = (v: unknown): MediaAttachment[] =>
  Array.isArray(v) ? v.filter(isAttachment) : [];

export function readNewModeDraft(pid: string): NewModeDraft | undefined {
  const base = readDraft(pid);
  const attach = sanitizeAttachments(kv.get<unknown>(newAttachmentsKey(pid)));
  if (!base && attach.length === 0) return undefined;
  return {
    goal: base?.goal ?? '',
    platforms: base?.platforms ?? [],
    attachments: attach,
    updatedAt: base?.updatedAt ?? Date.now(),
  };
}

export function writeNewModeDraft(pid: string, draft: NewModeDraft): void {
  const hasBase = Boolean(draft.goal.trim()) || draft.platforms.length > 0;
  if (hasBase || draft.attachments.length > 0) {
    writeDraft(pid, {
      goal: draft.goal,
      platforms: draft.platforms.filter((p) => (PLATFORMS as readonly string[]).includes(p)),
      updatedAt: draft.updatedAt,
    });
  } else {
    clearDraft(pid);
  }
  if (draft.attachments.length > 0) {
    kv.set(newAttachmentsKey(pid), draft.attachments);
  } else {
    kv.remove(newAttachmentsKey(pid));
  }
}

export function clearNewModeDraft(pid: string): void {
  clearDraft(pid);
  kv.remove(newAttachmentsKey(pid));
}

export function readFeedbackModeDraft(pid: string): FeedbackDraft | undefined {
  const raw = kv.get<Partial<FeedbackDraft>>(feedbackDraftKey(pid));
  if (!raw || typeof raw !== 'object') return undefined;
  const text = typeof raw.text === 'string' ? raw.text.slice(0, LIMITS.text) : '';
  const attachments = sanitizeAttachments(raw.attachments);
  if (!text.trim() && attachments.length === 0) return undefined;
  return {
    requestId: typeof raw.requestId === 'string' ? raw.requestId : '',
    text,
    attachments,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

export function writeFeedbackModeDraft(pid: string, draft: FeedbackDraft): void {
  if (!draft.text.trim() && draft.attachments.length === 0) {
    clearFeedbackModeDraft(pid);
    return;
  }
  kv.set(feedbackDraftKey(pid), {
    requestId: draft.requestId,
    text: draft.text.slice(0, LIMITS.text),
    attachments: draft.attachments,
    updatedAt: draft.updatedAt,
  });
}

export function clearFeedbackModeDraft(pid: string): void {
  kv.remove(feedbackDraftKey(pid));
}

/** 独立恢复两档草稿，互不覆盖、互不跳过。 */
export function restoreBothDrafts(pid: string): {
  readonly newDraft?: NewModeDraft;
  readonly feedbackDraft?: FeedbackDraft;
} {
  return {
    newDraft: readNewModeDraft(pid),
    feedbackDraft: readFeedbackModeDraft(pid),
  };
}
