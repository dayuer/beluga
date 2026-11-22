import { describe, expect, it } from 'vitest';
import type { StudioPlanView } from '../../../src/studio/protocol';
import { requestViewFromPlan } from './request-view';

const BASE: StudioPlanView = {
  planRef: 'plan1',
  draftRev: 3,
  title: '登录页改版',
  goal: '按新设计稿改登录页，加一键登录',
  stage: 'drafting',
  waitingOn: 'ai',
  headline: '计划在写，确认后就可以开工',
  progress: { done: 0, total: 2 },
  milestones: [],
  decisions: [],
  turns: [
    { id: 't1', who: 'customer', text: '帮我改登录页', at: 1_700_000_000_000 },
    { id: 't2', who: 'ai', text: '收到，先出计划', at: 1_700_000_001_000 },
  ],
  typing: true,
  moreTurns: false,
  activity: [],
};

const milestone = (
  ref: string,
  status: StudioPlanView['milestones'][number]['status'],
  criteria: string[] = [],
) => ({
  ref,
  title: `里程碑 ${ref}`,
  criteria,
  status,
  tasks: [],
});

const input = { projectId: 'p1', projectName: '优选商城', lang: 'zh' as const, updatedAt: 5_000 };

describe('requestViewFromPlan：各阶段映射', () => {
  it('起草：工作中，理解卡带草稿要点，还没有步骤条和开工卡', () => {
    const view: StudioPlanView = {
      ...BASE,
      milestones: [milestone('m0', 'planned'), milestone('m1', 'planned')],
    };
    const request = requestViewFromPlan(view, input);

    expect(request.summary.status).toBe('working');
    expect(request.summary.statusLine).toBe('计划在写，确认后就可以开工');
    expect(request.summary.projectId).toBe('p1');
    expect(request.summary.projectName).toBe('优选商城');
    expect(request.cards.some((c) => c.kind === 'understanding')).toBe(true);

    const understanding = request.cards.find((c) => c.kind === 'understanding');
    expect(understanding && 'points' in understanding ? understanding.points : []).toEqual([
      '里程碑 m0',
      '里程碑 m1',
    ]);
    expect(request.cards.some((c) => c.kind === 'start')).toBe(false);
    expect(request.cards.some((c) => c.kind === 'steps')).toBe(true);
  });

  it('开工 Gate 已升起时不再显示带动作的理解卡（P10 走查）', () => {
    const view: StudioPlanView = {
      ...BASE,
      stage: 'drafting',
      waitingOn: 'studio',
      typing: false,
      headline: '等你确认的计划已提交',
      draftRev: 2,
      milestones: [milestone('m0', 'planned')],
      gate: { kind: 'start', state: 'pending', draftRev: 2 },
    };
    const request = requestViewFromPlan(view, input);

    expect(request.cards.some((c) => c.kind === 'understanding')).toBe(false);
    expect(request.cards.some((c) => c.kind === 'start')).toBe(true);
  });

  it('待开工：等你处理/等工作室，出开工卡（需签名）', () => {
    const view: StudioPlanView = {
      ...BASE,
      stage: 'awaiting-start',
      waitingOn: 'studio',
      typing: false,
      headline: '等工作室批准开工',
      milestones: [milestone('m0', 'planned'), milestone('m1', 'planned')],
      gate: { kind: 'start', state: 'pending', draftRev: 3 },
    };
    const request = requestViewFromPlan(view, input);

    expect(request.summary.status).toBe('waiting');
    expect(request.summary.waitReason).toBe('queued');
    const start = request.cards.find((c) => c.kind === 'start');
    expect(start).toBeTruthy();
    expect(start && 'requiresSignature' in start ? start.requiresSignature : false).toBe(true);
    expect(start && 'stepCount' in start ? start.stepCount : 0).toBe(2);
    expect(request.cards.some((c) => c.kind === 'delivery')).toBe(false);
  });

  it('在做：步骤条标出进行中与已完成；未答决策出现问题卡；工作室离线时出一张等待卡', () => {
    const view: StudioPlanView = {
      ...BASE,
      stage: 'running',
      waitingOn: 'ai',
      typing: false,
      headline: '在做：里程碑 m1，已完成 1 项，共 2 项',
      progress: { done: 1, total: 2 },
      milestones: [milestone('m0', 'passed'), milestone('m1', 'working')],
      decisions: [
        { decisionId: 'd0', question: '要不要保留游客登录？', options: [{ id: 'o1', label: '保留' }], multi: false, open: true },
      ],
    };
    const request = requestViewFromPlan(view, input);

    expect(request.summary.status).toBe('working');

    const steps = request.cards.find((c) => c.kind === 'steps');
    expect(steps && 'steps' in steps ? steps.steps.map((s) => [s.id, s.status]) : []).toEqual([
      ['m0', 'done'],
      ['m1', 'active'],
    ]);

    const question = request.cards.find((c) => c.kind === 'question');
    expect(question && 'prompt' in question ? question.prompt : '').toBe('要不要保留游客登录？');
    expect(request.activeCardId).toBe('d0');
    expect(request.cards.some((c) => c.kind === 'wait')).toBe(false);

    const offline = requestViewFromPlan(view, { ...input, studioOnline: false });
    const wait = offline.cards.find((c) => c.kind === 'wait');
    expect(wait && 'reason' in wait ? wait.reason : '').toBe('offline');
  });

  it('待验收：等你处理，交付卡带上运营方的验收说明', () => {
    const view: StudioPlanView = {
      ...BASE,
      stage: 'awaiting-review',
      waitingOn: 'customer',
      typing: false,
      headline: '等你验收：里程碑 m0',
      milestones: [milestone('m0', 'review', ['可以记录', '数据不会丢']), milestone('m1', 'planned')],
      review: { milestoneRef: 'm0', verdict: 'pass', notes: '请看一下首页的登录入口' },
    };
    const request = requestViewFromPlan(view, input);

    expect(request.summary.status).toBe('needs-you');
    const delivery = request.cards.find((c) => c.kind === 'delivery');
    expect(delivery && 'summary' in delivery ? delivery.summary : '').toBe('请看一下首页的登录入口');
    expect(delivery && 'round' in delivery ? delivery.round : 0).toBe(1);
    expect(delivery && 'criteria' in delivery ? delivery.criteria : []).toEqual(['可以记录', '数据不会丢']);

    const steps = request.cards.find((c) => c.kind === 'steps');
    expect(steps && 'steps' in steps ? steps.steps[0] : undefined).toMatchObject({
      id: 'm0',
      status: 'waiting',
      waitReason: 'needs-human',
    });
    expect(request.results.plan.milestones).toHaveLength(2);
    expect(request.results.changes.pendingApproval).toBe(false);
  });

  it('完成：全部通过，状态 done，不再出等待卡', () => {
    const view: StudioPlanView = {
      ...BASE,
      stage: 'done',
      waitingOn: 'studio',
      typing: false,
      headline: '计划完成了',
      progress: { done: 2, total: 2 },
      milestones: [milestone('m0', 'passed'), milestone('m1', 'passed')],
    };
    const request = requestViewFromPlan(view, input);

    expect(request.summary.status).toBe('done');
    const steps = request.cards.find((c) => c.kind === 'steps');
    expect(steps && 'status' in steps ? steps.status : '').toBe('done');
    expect(request.cards.some((c) => c.kind === 'wait')).toBe(false);
    expect(request.cards.some((c) => c.kind === 'delivery')).toBe(false);
  });

  it('离线：执行机器不在线时整页进入等待（执行机器离线），完成的需求不受影响', () => {
    const running: StudioPlanView = {
      ...BASE,
      stage: 'running',
      waitingOn: 'ai',
      typing: false,
      milestones: [milestone('m0', 'working')],
    };
    const request = requestViewFromPlan(running, { ...input, studioOnline: false });

    expect(request.summary.status).toBe('waiting');
    expect(request.summary.waitReason).toBe('offline');
    expect(request.summary.statusLine).toBe('等待：执行机器暂时离线');

    const done = requestViewFromPlan({ ...running, stage: 'done' }, { ...input, studioOnline: false });
    expect(done.summary.status).toBe('done');
  });

  it('草稿改动：出改动卡（需签名），结果抽屉里有改动明细与动态', () => {
    const view: StudioPlanView = {
      ...BASE,
      stage: 'running',
      waitingOn: 'customer',
      typing: false,
      milestones: [milestone('m0', 'planned')],
      draftDiff: {
        draftRev: 4,
        added: [{ kind: 'milestone', title: '加上一键登录' }],
        changed: [{ kind: 'task', title: '改写登录表单', before: '旧', after: '新' }],
        removed: [{ kind: 'task', title: '旧任务' }],
      },
      gate: { kind: 'changes', state: 'pending', draftRev: 4 },
      activity: [{ at: 1_700_000_002_000, text: '开始了一项工作' }],
    };
    const request = requestViewFromPlan(view, input);

    const changes = request.cards.find((c) => c.kind === 'changes');
    expect(changes && 'added' in changes ? changes.added : []).toEqual(['加上一键登录']);
    expect(request.summary.status).toBe('needs-you');
    expect(request.results.changes).toMatchObject({
      added: ['加上一键登录'],
      modified: ['改写登录表单'],
      removed: ['旧任务'],
      pendingApproval: true,
    });
    expect(request.results.plan.activity).toEqual([{ id: 'activity-0', text: '开始了一项工作', at: 1_700_000_002_000 }]);
  });

  it('设计稿包：排在最前面，带上传进度；传完是已收下', () => {
    const uploading = requestViewFromPlan(BASE, {
      ...input,
      design: { name: '登录页设计稿.zip', fileCount: 12, imageCount: 10, specCount: 2, progress: 0.42 },
    });
    const first = uploading.cards[0];
    expect(first?.kind).toBe('design');
    expect(first && 'packageName' in first ? first.packageName : '').toBe('登录页设计稿.zip');
    expect(first && 'progress' in first ? first.progress : -1).toBe(0.42);
    expect(first?.status).toBe('pending');
    expect(first && 'imageCount' in first ? first.imageCount : 0).toBe(10);

    const done = requestViewFromPlan(BASE, {
      ...input,
      design: { name: '登录页设计稿.zip', fileCount: 12, imageCount: 10, specCount: 2, progress: 1, done: true },
    });
    expect(done.cards[0]?.status).toBe('done');
  });

  it('上线：视图带 release 时出上线卡（需签名），目标版本与线上版本都在', () => {
    const view: StudioPlanView = {
      ...BASE,
      stage: 'done',
      waitingOn: 'customer',
      typing: false,
      headline: '等你批准上线',
      milestones: [milestone('m0', 'passed')],
      release: { envId: 'prod', envTitle: '正式环境', version: '1.4.0', lastVersion: '1.3.2', lastReleaseAt: 1_700_000_000_000 },
    };
    const request = requestViewFromPlan(view, input);
    const release = request.cards.find((c) => c.kind === 'release');
    expect(release && 'envTitle' in release ? release.envTitle : '').toBe('正式环境');
    expect(release && 'version' in release ? release.version : '').toBe('1.4.0');
    expect(release && 'lastVersion' in release ? release.lastVersion : '').toBe('1.3.2');
    expect(release && 'requiresSignature' in release ? release.requiresSignature : false).toBe(true);
    expect(request.summary.status).toBe('needs-you');
  });

  it('对话：turn 映射成消息，空消息丢掉', () => {
    const request = requestViewFromPlan(
      { ...BASE, turns: [...BASE.turns, { id: 't3', who: 'studio', text: '   ', at: 1 }] },
      input,
    );
    expect(request.messages).toEqual([
      { id: 't1', role: 'customer', text: '帮我改登录页', createdAt: 1_700_000_000_000 },
      { id: 't2', role: 'ai', text: '收到，先出计划', createdAt: 1_700_000_001_000 },
    ]);
  });
});
