import { describe, expect, it } from 'vitest';
import { customStatus } from '../packages/mac/src/fork/phone-advanced.js';

describe('Settings › Phone › Advanced › Custom address', () => {
  it('says nothing without an address', () => {
    expect(customStatus(undefined, undefined, 'auto')).toBeUndefined();
  });
  it('says whether it listens, and why not', () => {
    expect(customStatus('10.0.0.5:7788', { state: 'listening' }, 'auto')).toMatchObject({ ok: true, text: expect.stringContaining('Listening on 10.0.0.5:7788') });
    expect(customStatus('10.0.0.5:7788', { state: 'failed', error: 'that port is already in use' }, 'auto')).toMatchObject({ ok: false, text: expect.stringContaining('that port is already in use') });
    expect(customStatus('10.0.0.5:7788', undefined, 'none')?.text).toMatch(/network only/);
    expect(customStatus('10.0.0.5:7788', undefined, 'auto')?.text).toMatch(/paired/);
  });
});
