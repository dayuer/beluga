import { describe, expect, it } from 'vitest';
import { scheduleSentence } from '../src/core/sentinel/model.js';
import { eventWords, statusWords } from '../src/core/ci/model.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Mac app's own tsc checks the module
const w: any = await import('../packages/mac/src/lib/ci-sentinel-words.js' as string);

/** A sentinel's schedule and a GitHub run's words (packages/mac/src/lib/ci-sentinel-words.ts): the engine's English, else Chinese. */
describe('sentinel and CI words in the language shown', () => {
  const triggers = [
    { kind: 'schedule', every: 'day', at: '07:00' },
    { kind: 'schedule', every: 'hours', hours: 3, at: '00:00' },
    { kind: 'schedule', every: 'week', days: [1, 3], at: '09:30' },
    { kind: 'manual' },
    { kind: 'webhook', signature: 'github' },
  ] as const;

  it('says exactly what the engine says in English', () => {
    for (const tr of triggers) expect(w.localSchedule(tr, () => undefined, 'en')).toBe(scheduleSentence(tr as never));
    expect(w.localStatusWords({ status: 'completed', conclusion: 'success' }, 'en')).toBe(statusWords({ status: 'completed', conclusion: 'success' }));
    expect(w.localEventWords('pull_request', 'en')).toBe(eventWords('pull_request'));
    expect(w.localPausedWhy('Paused after 3 failures in a row', 'en')).toBe('Paused after 3 failures in a row');
  });

  it('says it in Chinese', () => {
    expect(w.localSchedule(triggers[0], () => undefined, 'zh-CN')).toBe('每天 7:00');
    expect(w.localSchedule(triggers[1], () => undefined, 'zh-CN')).toBe('每 3 小时');
    expect(w.localSchedule(triggers[2], () => undefined, 'zh-CN')).toBe('每周周一、周三 9:30');
    expect(w.localSchedule(triggers[4], () => undefined, 'zh-CN')).toBe('GitHub 向它的地址发送时');
    expect(w.localStatusWords({ status: 'completed', conclusion: 'failure' }, 'zh-CN')).toBe('失败');
    expect(w.localEventWords('schedule', 'zh-CN')).toBe('定时');
    expect(w.localEventWords('some_new_event', 'zh-CN')).toBe('Some new event');
    expect(w.localPausedWhy('Paused after 3 failures in a row', 'zh-CN')).toBe('连续失败 3 次后已暂停');
  });
});
