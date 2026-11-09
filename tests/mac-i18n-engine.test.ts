import { describe, expect, it } from 'vitest';
import type { AppState } from '../src/core/store.js';
import { initialAppState as initialState, reduceApp as reduce } from '../src/client/screen.js';
import { menuSpec } from '../src/ui/menus.js';
import { stateOf, workspaceButtons } from '../src/ui/workspace-models.js';
import { windowsOf } from '../src/ui/usage-cards.js';
import { describePr } from '../src/shared/format.js';
import { notOnPrLabel } from '../src/core/branch-state.js';
import type { Project, Workspace } from '../src/workspaces/types.js';

// The Mac app's own modules through a variable: the root typecheck can't follow its @beluga paths (its own tsc checks them).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the module types are checked by the Mac app's own tsc
const mac = (file: string): Promise<any> => import(`../packages/mac/src/${file}`) as Promise<any>;
const w = await mac('lib/engine-words.js');

const ws = (over: Partial<Workspace>): Workspace => ({
  id: 'w1', projectRoot: '/p', name: 'fix-auth', path: '/wt/fix-auth', kind: 'worktree', branch: 'klaud/fix-auth', base: 'origin/main',
  createdAt: 1, projectId: 'p1', external: false, status: { changed: 2, ahead: 3, behind: 0 }, ...over,
});
const project: Project = {
  id: 'p1', name: 'app', root: '/p', base: 'origin/main', scripts: { setup: { command: 'npm install', source: 'yours' }, run: { command: 'npm run dev', source: 'yours' } },
  workspaces: [
    ws({ id: 'main', name: 'main', kind: 'main', branch: 'main', status: { changed: 0, ahead: 0, behind: 0 } }),
    ws({}),
    ws({ id: 'clean', name: 'clean', status: { changed: 0, ahead: 2, behind: 0 } }),
    ws({ id: 'done', name: 'done', status: { changed: 0, ahead: 0, behind: 0 } }),
    ws({ id: 'c1', name: 'question', kind: 'chat', status: undefined }),
    ws({ id: 'old', name: 'old', archived: true }),
  ],
} as Project;
const base = (): AppState => {
  const s = reduce(initialState('room'), { type: 'projects', projects: [project] });
  return { ...s, projectGroups: [{ name: 'Work', projects: ['/p'] }, { name: 'Side', projects: [] }] } as AppState;
};

describe('the engine words on the Mac', () => {
  it('English stays exactly as the engine made it', () => {
    const state = base();
    for (const x of project.workspaces) {
      expect(w.localStateOf(state, x, 0, Date.now(), 'en')).toEqual(stateOf(state, x, 0));
      for (const b of workspaceButtons(state, x)) expect(w.localButton(b, 'en')).toBe(b);
    }
    for (const menu of [{ kind: 'project', id: 'p1' }, { kind: 'settings' }, { kind: 'settings', section: 'notify' }] as const) {
      expect(w.localMenuSpec(state, menu, 'en')).toEqual(menuSpec(state, menu));
    }
    for (const win of windowsOf({ fiveHour: { pct: 10 }, week: { pct: 20 }, windows: [{ label: 'Daily', pct: 5 }] })) expect(w.localWindow(win, 'en')).toBe(win);
    expect(w.localRootLabel('mia · api (read-only)', 'en')).toBe('mia · api (read-only)');
    expect(w.localModelName('Default', 'en')).toBe('Default');
    expect(w.roomCallName('en')).toBe('the Room');
    const pr = { number: 12, state: 'OPEN', checks: 'passing', review: 'APPROVED', draft: true } as never;
    expect(w.localDescribePr(pr, 'en')).toBe(describePr(pr));
    expect(w.localNotOnPr({ count: 3, number: 398 }, 'en')).toBe(notOnPrLabel({ count: 3, number: 398 }));
  });

  it('says a workspace’s state in Chinese', () => {
    const zh = (label: string): string => w.localStateLabel(label, 'zh-CN');
    expect(zh('2 uncommitted changes')).toBe('2 处未提交的改动');
    expect(zh('Ready to merge · 1 commit')).toBe('可以合并 · 1 个提交');
    expect(zh('Main folder')).toBe('主文件夹');
    expect(zh('Chat · 5m ago')).toBe('聊天 · 5 分钟前');
    expect(zh('Agent working 1m05s · 2 sub-agents running')).toBe('Agent 已工作 1 分 05 秒 · 2 个子 agent 在运行');
    expect(zh('3 commits not on PR #398 · 1 uncommitted change')).toBe('3 个提交不在 PR #398 里 · 1 处未提交的改动');
    expect(zh('Something new')).toBe('Something new');
    const state = base();
    for (const x of project.workspaces) expect(w.localStateOf(state, x, 0, Date.now(), 'zh-CN').label).not.toBe(stateOf(state, x, 0).label);
  });

  it('says the toolbar’s hints in Chinese, and keeps what it doesn’t know', () => {
    const state = base();
    const hints = project.workspaces.flatMap((x) => workspaceButtons(state, x)).map((b) => w.localButton(b, 'zh-CN'));
    expect(hints.find((b: { action: string }) => b.action === 'run')).toMatchObject({ label: '运行', hint: '在终端标签页里运行 npm run dev' });
    expect(hints.find((b: { action: string }) => b.action === 'handoff')?.hint).toBe('打开 Beluga 网络就能移交给朋友，或者邀请别人进你的房间');
    expect(hints.find((b: { action: string; hint: string }) => b.action === 'merge' && !b.hint.startsWith('先'))?.hint).toBe('把 2 个提交合并到 app 的主文件夹');
    expect(w.localButtonHint('A reason only Codex has', 'zh-CN')).toBe('A reason only Codex has');
  });

  it('keeps a menu’s options and ids, only its words change', () => {
    const state = base();
    const en = menuSpec(state, { kind: 'project', id: 'p1' })!;
    const zh = w.localMenuSpec(state, { kind: 'project', id: 'p1' }, 'zh-CN');
    expect(zh.options.map((o: { id: string }) => o.id)).toEqual(en.options.map((o) => o.id));
    expect(zh.intro[1]).toBe('所在分组：Work');
    const by = (id: string) => zh.options.find((o: { id: string }) => o.id === id);
    expect(by('p-worktree')).toMatchObject({ label: '新建工作树', hint: '基于最新的 origin' });
    expect(by('p-scripts').hint).toBe('设置：npm install');
    expect(by('p-group:Side').label).toBe('移到“Side”');
    expect(by('p-ungroup').label).toBe('从“Work”移出');
    expect(by('close').label).toBe('关闭');
    const settings = w.localMenuSpec(state, { kind: 'settings', section: 'notify' }, 'zh-CN');
    expect(settings.title).toBe('设置 › 通知');
    expect(settings.options.map((o: { id: string }) => o.id)).toEqual(menuSpec(state, { kind: 'settings', section: 'notify' })!.options.map((o) => o.id));
  });

  it('names plan windows, shared folders and the default model in Chinese', () => {
    const [five, week, daily, odd] = windowsOf({ fiveHour: { pct: 10 }, week: { pct: 20 }, windows: [{ label: 'Daily', pct: 5 }, { label: '3-hour', pct: 1 }] }).map((x) => w.localWindow(x, 'zh-CN'));
    expect([five.label, week.label, week.short, daily.label, odd.label]).toEqual(['5 小时', '每周', '周', '每日', '3 小时']);
    expect(w.localRootLabel('api (read-only)', 'zh-CN')).toBe('api（只读）');
    expect(w.localRootLabel('payments (workspace)', 'zh-CN')).toBe('payments（工作区）');
    expect(w.localModelName('Codex · Default', 'zh-CN')).toBe('Codex · 默认');
    expect(w.localDescribePr({ number: 7, state: 'OPEN', checks: 'failing' } as never, 'zh-CN')).toBe('PR #7 · 检查没通过');
  });
});
