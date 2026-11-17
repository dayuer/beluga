import { describe, expect, it } from 'vitest';
import { refusalKey, submitNext, type SubmitState } from '../../packages/studio-app/lib/submit';

/** BLG-85: the request state machine, without a browser. */

const idle: SubmitState = { phase: 'idle' };
const sending: SubmitState = { phase: 'sending', opId: 'op-1' };
const queued: SubmitState = { phase: 'queued', opId: 'op-1' };

describe('the new-request submit state machine', () => {
  it('goes idle -> sending -> queued -> done', () => {
    const started = submitNext(idle, { type: 'start', opId: 'op-1' });
    expect(started).toEqual(sending);
    const atQueue = submitNext(started, { type: 'queued' });
    expect(atQueue).toEqual(queued);
    expect(submitNext(atQueue, { type: 'done' })).toEqual({ phase: 'done', opId: 'op-1' });
  });

  it('accepts a done receipt straight from sending (the studio was online)', () => {
    expect(submitNext(sending, { type: 'done' })).toEqual({ phase: 'done', opId: 'op-1' });
  });

  it('carries the refusal code and ignores a second answer after a terminal phase', () => {
    const refused = submitNext(queued, { type: 'refused', code: 'rate-limited' });
    expect(refused).toEqual({ phase: 'refused', opId: 'op-1', code: 'rate-limited' });
    expect(submitNext(refused, { type: 'done' })).toBe(refused);
  });

  it('marks a network failure and can start again with a new opId', () => {
    const failed = submitNext(sending, { type: 'failed', failure: 'offline' });
    expect(failed).toEqual({ phase: 'failed', opId: 'op-1', failure: 'offline' });
    expect(submitNext(failed, { type: 'queued' })).toBe(failed);
    expect(submitNext(failed, { type: 'start', opId: 'op-2' })).toEqual({ phase: 'sending', opId: 'op-2' });
  });

  it('keeps a queued answer idempotent and resets on demand', () => {
    expect(submitNext(queued, { type: 'queued' })).toEqual(queued);
    expect(submitNext(queued, { type: 'reset' })).toEqual({ phase: 'idle' });
  });

  it('maps every refusal code to a customer-language key', () => {
    expect(refusalKey('not-allowed')).toBe('refusal.not-allowed');
    expect(refusalKey('unknown-plan')).toBe('refusal.unknown-plan');
  });
});
