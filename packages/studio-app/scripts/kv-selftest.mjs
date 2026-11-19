#!/usr/bin/env node
/**
 * Minimal self-test for native in-memory kv fallback when globalThis.localStorage is absent.
 * Run with: npx tsx scripts/kv-selftest.mjs
 */
import assert from 'node:assert/strict';

delete globalThis.localStorage;
assert.equal(typeof globalThis.localStorage, 'undefined', 'localStorage must be undefined');

const { session } = await import('../lib/session.ts');
const { kv } = await import('../lib/kv.ts');

assert.equal(session.snapshot(), null);
assert.equal(session.token(), undefined);

const sample = {
  session: 'tok-native-test',
  expiresAt: Date.now() + 60_000,
  customerId: 'cust-1',
};
session.set(sample);

assert.equal(session.snapshot(), sample.session);
assert.equal(session.token(), sample.session);

kv.set('draft:p1', { goal: 'hello' });
assert.deepEqual(kv.get('draft:p1'), { goal: 'hello' });
kv.remove('draft:p1');
assert.equal(kv.get('draft:p1'), undefined);

kv.set('temp', 123);
kv.clear();
assert.equal(kv.get('temp'), undefined);
assert.equal(session.snapshot(), null);

console.log('[kv-selftest] PASS: localStorage=undefined, session.snapshot() and session.token() preserved after session.set()');
