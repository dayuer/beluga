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

/** 客户设备标记 (BLG-34). */
describe('client tag in the phone list', () => {
  const projects = [{ id: 'shop', name: 'Shop' }];
  it('names the project on a customer’s phone, nothing on your own', async () => {
    const { clientTag } = await import('../packages/mac/src/phone/phone-model.js');
    expect(clientTag({ client: { project: 'shop' } }, projects)).toMatch(/Shop/);
    expect(clientTag({ client: { project: 'gone' } }, projects)).toMatch(/gone/);
    expect(clientTag({}, projects)).toBeUndefined();
  });
});
