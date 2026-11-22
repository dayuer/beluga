import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockKv = new Map<string, unknown>();
const mockLocales = vi.fn(() => [{ languageCode: 'zh' }]);

vi.mock('../kv', () => ({
  kv: {
    get: vi.fn((k: string) => mockKv.get(k)),
    set: vi.fn((k: string, v: unknown) => mockKv.set(k, v)),
    remove: vi.fn((k: string) => mockKv.delete(k)),
  },
}));

vi.mock('./kv', () => ({
  kv: {
    get: vi.fn((k: string) => mockKv.get(k)),
    set: vi.fn((k: string, v: unknown) => mockKv.set(k, v)),
    remove: vi.fn((k: string) => mockKv.delete(k)),
  },
}));

vi.mock('expo-localization', () => ({
  getLocales: () => mockLocales(),
}));

import { detectLang, en, t, zh } from './strings';

describe('strings', () => {
  beforeEach(() => {
    mockKv.clear();
    mockLocales.mockReturnValue([{ languageCode: 'zh' }]);
  });

  it('keeps zh and en keys identical', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it('interpolates variables and leaves unknown placeholders visible', () => {
    expect(t('zh', 'plan.waitAnswer', { n: 3 })).toBe('在等你：回答 3 个问题');
    expect(t('en', 'plan.waitAnswer', { n: 3 })).toBe('Waiting on you: answer 3 questions');
    expect(t('zh', 'time.minutes', {})).toBe('{n} 分钟前');
  });

  it('detects system language and prefers manual kv setting', () => {
    mockLocales.mockReturnValue([{ languageCode: 'en' }]);
    expect(detectLang()).toBe('en');

    mockKv.set('lang', 'zh');
    expect(detectLang()).toBe('zh');

    mockKv.clear();
    mockLocales.mockReturnValue([{ languageCode: 'ja' }]);
    expect(detectLang()).toBe('zh');
  });
});
