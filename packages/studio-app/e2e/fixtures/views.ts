import type { StudioMilestone, StudioPlanView, StudioTask } from '../../../../src/studio/protocol';

/**
 * The plan-page fixtures the e2e run pushes through the fake daemon's control port (BLG-91).
 * One per page phase, each a complete StudioPlanView (the hub parses it strictly).
 */
const task = (patch: Partial<StudioTask> & Pick<StudioTask, 'ref' | 'title' | 'status'>): StudioTask => ({
  acceptance: [],
  ...patch,
});

const milestone = (patch: Partial<StudioMilestone> & Pick<StudioMilestone, 'ref' | 'title' | 'status'>): StudioMilestone => ({
  criteria: [],
  tasks: [],
  ...patch,
});

const at = 1_760_000_000_000;

const base = (patch: Partial<StudioPlanView> = {}): StudioPlanView =>
  ({
    planRef: 'plan1',
    draftRev: 1,
    title: '饮水打卡',
    goal: '做一个能记录每天喝水的 App，有提醒和统计。',
    stage: 'running',
    waitingOn: 'ai',
    headline: 'AI 在做：提醒（1 / 2）',
    progress: { done: 1, total: 3 },
    milestones: [
      milestone({ ref: 'm0', title: '记录喝水', status: 'passed', criteria: ['可以记录'], tasks: [task({ ref: 'm0-t0', title: '喝水按钮', status: 'done' })] }),
      milestone({
        ref: 'm1',
        title: '每日提醒',
        status: 'working',
        criteria: ['每天三次提醒', '可以关掉提醒'],
        tasks: [
          task({ ref: 'm1-t0', title: '提醒设置', status: 'doing', goal: '让客户自己选时间' }),
          task({ ref: 'm1-t1', title: '通知文案', status: 'planned' }),
        ],
      }),
    ],
    decisions: [],
    turns: [{ id: 't0', who: 'ai', text: '开始做提醒了', at }],
    typing: false,
    moreTurns: false,
    activity: [
      { at, text: '开始做每日提醒' },
      { at: at - 60_000, text: '记录喝水已完成' },
    ],
    ...patch,
  }) as StudioPlanView;

export const views = {
  running: base(),

  draftingAi: base({
    stage: 'drafting',
    waitingOn: 'ai',
    headline: 'AI 正在写计划',
    progress: { done: 0, total: 0 },
    milestones: [],
    typing: true,
    activity: [{ at, text: '开始整理需求' }],
  }),

  confirm: base({
    stage: 'drafting',
    waitingOn: 'customer',
    headline: '计划已拟好，等你确认',
    draftRev: 2,
    milestones: [
      milestone({ ref: 'm0', title: '记录喝水', status: 'planned', criteria: ['可以记录'], tasks: [task({ ref: 'm0-t0', title: '喝水按钮', status: 'planned' })] }),
      milestone({ ref: 'm1', title: '每日提醒', status: 'planned', criteria: ['每天三次提醒'], tasks: [task({ ref: 'm1-t0', title: '提醒设置', status: 'planned' })] }),
    ],
    typing: false,
    decisions: [],
  }),

  awaitingStart: base({
    stage: 'drafting',
    waitingOn: 'studio',
    headline: '等你确认的计划已提交',
    draftRev: 2,
    milestones: [milestone({ ref: 'm0', title: '记录喝水', status: 'planned' })],
    gate: { kind: 'start', state: 'pending', draftRev: 2 },
  }),

  decide: base({
    waitingOn: 'customer',
    headline: '在等你回答',
    decisions: [
      {
        decisionId: 'd-m0-t0',
        question: '先做提醒还是先做统计？',
        options: [
          { id: 'o0', label: '先做提醒', description: '更着急' },
          { id: 'o1', label: '先做统计' },
        ],
        multi: false,
        open: true,
      },
    ],
  }),

  review: base({
    stage: 'awaiting-review',
    waitingOn: 'customer',
    headline: '等你验收：记录喝水',
    progress: { done: 1, total: 2 },
    milestones: [
      milestone({ ref: 'm0', title: '记录喝水', status: 'review', criteria: ['可以记录', '数据不会丢'], tasks: [task({ ref: 'm0-t0', title: '喝水按钮', status: 'done' })] }),
      milestone({ ref: 'm1', title: '每日提醒', status: 'planned' }),
    ],
    review: { milestoneRef: 'm0', verdict: 'pass', notes: '点一下就能记录，列表也会更新。' },
  }),

  changes: base({
    draftRev: 2,
    headline: '计划有改动，等你查看',
    milestones: [
      milestone({ ref: 'm0', title: '记录喝水', status: 'passed', tasks: [task({ ref: 'm0-t0', title: '喝水按钮', status: 'done' })] }),
      milestone({ ref: 'm1', title: '提醒与统计', status: 'working', tasks: [task({ ref: 'm1-t0', title: '提醒设置', status: 'doing' })] }),
    ],
    draftDiff: {
      draftRev: 2,
      added: [{ kind: 'task', title: '每周统计', under: '提醒与统计' }],
      changed: [{ kind: 'milestone', title: '每日提醒', before: '每天三次提醒', after: '可以自己设次数' }],
      removed: [{ kind: 'task', title: '固定文案提醒' }],
    },
  }),

  awaitingChanges: base({
    draftRev: 2,
    waitingOn: 'studio',
    headline: '改动已提交，等工作室批准',
    draftDiff: {
      draftRev: 2,
      added: [{ kind: 'task', title: '每周统计' }],
      changed: [],
      removed: [],
    },
    gate: { kind: 'changes', state: 'pending', draftRev: 2 },
  }),

  done: base({
    stage: 'done',
    waitingOn: 'studio',
    headline: '这个计划已完成',
    progress: { done: 3, total: 3 },
    milestones: [
      milestone({ ref: 'm0', title: '记录喝水', status: 'passed' }),
      milestone({ ref: 'm1', title: '每日提醒', status: 'passed' }),
    ],
    activity: [{ at, text: '计划完成' }],
  }),
} as const;
