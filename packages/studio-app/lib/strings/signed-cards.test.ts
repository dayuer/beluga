import { describe, expect, it } from 'vitest';
import { en, signedCardStrings, zh } from './signed-cards';

describe('lib/strings/signed-cards', () => {
  it('has identical keys in zh and en', () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it('matches value types (string vs function) between zh and en', () => {
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(typeof en[key]).toBe(typeof zh[key]);
    }
  });

  it('returns the right bundle for each language', () => {
    expect(signedCardStrings('zh')).toBe(zh);
    expect(signedCardStrings('en')).toBe(en);
  });
});
