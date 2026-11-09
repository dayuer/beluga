import { describe, expect, it } from 'vitest';
import { interpolate, makeT, resolveLocale } from '../src/shared/i18n.js';

describe('which language the screen shows', () => {
  it('a language picked is the one shown', () => {
    expect(resolveLocale('en', ['zh-CN'])).toBe('en');
    expect(resolveLocale('zh-CN', ['en-US'])).toBe('zh-CN');
  });

  it('system: the first of the system’s languages Beluga has, any Chinese as Simplified Chinese', () => {
    expect(resolveLocale('system', ['zh-Hans-CN', 'en-US'])).toBe('zh-CN');
    expect(resolveLocale('system', ['zh-TW'])).toBe('zh-CN');
    expect(resolveLocale('system', ['en-GB', 'zh-CN'])).toBe('en');
    expect(resolveLocale('system', ['fr-FR', 'zh-CN'])).toBe('zh-CN');
    expect(resolveLocale('system', [])).toBe('en');
  });

  it('a setting it doesn’t know (a newer Beluga’s, a broken file) follows the system', () => {
    expect(resolveLocale('de' as never, ['zh-CN'])).toBe('zh-CN');
    expect(resolveLocale(undefined, ['en-US'])).toBe('en');
  });
});

describe('words with things filled in', () => {
  it('{name} takes its value; one with no value stays as written, so a missing one is seen', () => {
    expect(interpolate('Open {name} in {where}', { name: 'api', where: 'Finder' })).toBe('Open api in Finder');
    expect(interpolate('{n} tasks', { n: 3 })).toBe('3 tasks');
    expect(interpolate('Hi {who}', {})).toBe('Hi {who}');
  });

  it('a dictionary per language; a function for words that change with a number; English when the language has none', () => {
    const en = { 'a.open': 'Open', 'a.tasks': (v: Record<string, string | number>) => `${v.n} ${v.n === 1 ? 'task' : 'tasks'}`, 'a.hi': 'Hi {who}' } as const;
    const zh = { 'a.open': '打开', 'a.tasks': (v: Record<string, string | number>) => `${v.n} 个任务`, 'a.hi': '你好，{who}' };
    const tOf = makeT(en, { 'zh-CN': zh });
    expect(tOf('en')('a.tasks', { n: 1 })).toBe('1 task');
    expect(tOf('en')('a.tasks', { n: 2 })).toBe('2 tasks');
    expect(tOf('zh-CN')('a.tasks', { n: 2 })).toBe('2 个任务');
    expect(tOf('zh-CN')('a.hi', { who: 'Kay' })).toBe('你好，Kay');
    expect(makeT(en, {})('zh-CN')('a.open')).toBe('Open');
  });
});
