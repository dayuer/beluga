import { describe, expect, it } from 'vitest';
import * as cards from './cards';
import * as drawer from './drawer';
import * as questions from './questions';
import * as steps from './steps';
import * as understanding from './understanding';
import * as wait from './wait';

describe('A4b regional strings (SS-182)', () => {
  const modules = [
    { name: 'questions', mod: questions },
    { name: 'understanding', mod: understanding },
    { name: 'steps', mod: steps },
    { name: 'wait', mod: wait },
    { name: 'cards', mod: cards },
    { name: 'drawer', mod: drawer },
  ] as const;

  it.each(modules)('$name has identical zh and en keys and non-empty values', ({ mod }) => {
    const zhKeys = Object.keys(mod.zh).sort();
    const enKeys = Object.keys(mod.en).sort();
    expect(enKeys).toEqual(zhKeys);

    for (const key of zhKeys) {
      expect((mod.zh as Record<string, string>)[key]!.trim().length).toBeGreaterThan(0);
      expect((mod.en as Record<string, string>)[key]!.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(modules)('$name contains no retired terms (工作室/产物/变更) in zh values', ({ mod }) => {
    const retired = ['工作室', '产物', '变更'] as const;
    for (const [key, value] of Object.entries(mod.zh)) {
      for (const word of retired) {
        expect(value, `${key} should not contain "${word}"`).not.toContain(word);
      }
    }
  });

  it('interpolates slot variables in regional translation helpers', () => {
    expect(questions.tQuestions('zh', 'questions.suggested', { answer: '短信验证码' })).toBe('我先按：短信验证码');
    expect(questions.tQuestions('en', 'questions.moreInChat', { n: 2 })).toBe('2 more — just say them in the chat');
    expect(steps.tSteps('en', 'steps.stepLabel', { i: 2, status: 'Done' })).toBe('Step 2 · Done');
    expect(cards.tCards('zh', 'designCard.uploading', { pct: 45 })).toBe('上传中 45%');
    expect(drawer.tDrawer('en', 'outputs.round', { n: 3 })).toBe('Round 3');
    expect(understanding.tUnderstanding('zh', 'understanding.expand', { n: 2 })).toBe('展开其余 2 条');
    expect(wait.tWait('en', 'wait.noAction')).toBe('You don’t need to do anything');
  });
});
