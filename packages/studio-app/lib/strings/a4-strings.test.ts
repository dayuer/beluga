import { describe, expect, it } from 'vitest';
import * as me from './me';
import * as media from './media';
import * as news from './new';
import * as requests from './requests';
import * as voice from './voice';

const GROUPS = [
  { name: 'requests', mod: requests },
  { name: 'new', mod: news },
  { name: 'me', mod: me },
  { name: 'media', mod: media },
  { name: 'voice', mod: voice },
] as const;

describe('A4 string modules zh/en parity (SS-201)', () => {
  it('has identical zh and en keys and no empty values across requests, new, me, media, and voice', () => {
    for (const { name, mod } of GROUPS) {
      const zhKeys = Object.keys(mod.zh).sort();
      const enKeys = Object.keys(mod.en).sort();
      expect(enKeys, `${name} keys mismatch`).toEqual(zhKeys);

      for (const k of zhKeys) {
        const zhVal = (mod.zh as Record<string, string>)[k];
        const enVal = (mod.en as Record<string, string>)[k];
        expect(zhVal?.trim().length, `${name}.zh[${k}] empty`).toBeGreaterThan(0);
        expect(enVal?.trim().length, `${name}.en[${k}] empty`).toBeGreaterThan(0);
      }
    }
  });
});
