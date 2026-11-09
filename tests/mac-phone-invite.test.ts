import { describe, expect, it } from 'vitest';
import { DEFAULT_INVITE_DAYS, INVITE_DAYS, clientInviteArgs } from '../packages/mac/src/phone/phone-model.js';

/** 邀请客户 (BLG-33): what the Mac sends to companion.pair.start for a customer's invite. */
describe('client invite arguments', () => {
  it('carry the project and a day by default', () => {
    expect(clientInviteArgs('shop')).toEqual({ project: 'shop', ttlMs: 24 * 3600_000 });
    expect(DEFAULT_INVITE_DAYS).toBe(1);
  });
  it('turn the chosen days into milliseconds, never past a week', () => {
    expect(clientInviteArgs('shop', 3).ttlMs).toBe(3 * 24 * 3600_000);
    expect(clientInviteArgs('shop', 30).ttlMs).toBe(7 * 24 * 3600_000);
    expect(clientInviteArgs('shop', 0).ttlMs).toBe(24 * 3600_000);
    expect(Math.max(...INVITE_DAYS)).toBe(7);
  });
});
