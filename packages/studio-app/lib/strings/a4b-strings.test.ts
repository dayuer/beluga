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

  it('interpolates slot variables in regional translation helpers', () => {
    expect(questions.tQuestions('zh', 'questions.remaining', { n: 2 })).toBe('还差 2 题');
    expect(questions.tQuestions('en', 'questions.remaining', { n: 2 })).toBe('2 left');
    expect(steps.tSteps('en', 'steps.stepLabel', { i: 2, status: 'Done' })).toBe('Step 2 · Done');
    expect(cards.tCards('zh', 'designCard.uploading', { pct: 45 })).toBe('上传中 45%');
    expect(drawer.tDrawer('en', 'outputs.round', { n: 3 })).toBe('Round 3');
    expect(understanding.tUnderstanding('zh', 'understanding.expand', { n: 2 })).toBe('展开其余 2 条');
    expect(wait.tWait('en', 'wait.noAction')).toBe('You don’t need to do anything');
  });
});
