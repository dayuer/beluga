import { describe, expect, it } from 'vitest';
import { compareZh } from '../scripts/zh-check.mjs';

describe("comparing upstream's Chinese with the fork's (docs/chinese.md)", () => {
  const before = { Work: '工作', Save: '保存', Old: '旧的', Open: '打开' };
  const after = { Work: '工作区', Save: '保存', Open: '打开', New: '新的' };

  it('lists what upstream added, reworded and dropped', () => {
    const r = compareZh({ before, after, fork: {} });
    expect(r.added).toEqual(['New']);
    expect(r.changed).toEqual(['Work']);
    expect(r.removed).toEqual(['Old']);
  });

  it("says which of the fork's overrides need a look, and leaves the fork's own strings alone", () => {
    const fork = { Work: '计划', Old: '老的', Open: '打开', 'Synon Studio': 'Synon Studio' };
    const r = compareZh({ before, after, fork });
    expect(r.overrides.sort()).toEqual(['Old', 'Open', 'Work']);
    expect(r.recheck).toEqual(['Work']);
    expect(r.gone).toEqual(['Old']);
    expect(r.redundant).toEqual(['Open']);
  });
});
