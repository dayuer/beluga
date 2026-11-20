import type { Hub } from '../hub';
import type { PlanRes, PlansRes, ProjectsRes, StudioStatus, TurnsRes } from '../hub-schema';

const NOW = 1_763_600_000_000;

const DEMO_STUDIO_STATUS: StudioStatus = {
  online: true,
  lastSyncAt: NOW,
};

const DEMO_PROJECTS: ProjectsRes = {
  projects: [
    {
      id: 'proj-shop',
      name: '优选商城 App',
      studioId: 'studio-demo',
      studioName: 'Synon 演示节点',
    },
    {
      id: 'proj-ops',
      name: '运营后台',
      studioId: 'studio-demo',
      studioName: 'Synon 演示节点',
    },
  ],
};

const DEMO_PLANS: Record<string, PlansRes> = {
  'proj-shop': {
    plans: [
      {
        planRef: 'req-decision',
        title: '登录页改版与一键登录',
        headline: '等你回答 1 个问题',
        stage: 'drafting',
        waitingOn: 'customer',
        progress: { done: 0, total: 3 },
        updatedAt: NOW - 2 * 60_000,
      },
      {
        planRef: 'req-confirm',
        title: '支付对账异常提示',
        headline: '等你批准开工',
        stage: 'drafting',
        waitingOn: 'customer',
        progress: { done: 0, total: 2 },
        updatedAt: NOW - 5 * 60_000,
      },
    ],
    studio: DEMO_STUDIO_STATUS,
  },
  'proj-ops': {
    plans: [
      {
        planRef: 'req-review',
        title: '订单导出增加筛选条件',
        headline: '等你验收第 1 步交付',
        stage: 'awaiting-review',
        waitingOn: 'customer',
        progress: { done: 1, total: 2 },
        updatedAt: NOW - 10 * 60_000,
      },
      {
        planRef: 'req-changes',
        title: '发货通知模板消息',
        headline: '等你确认计划改动',
        stage: 'running',
        waitingOn: 'customer',
        progress: { done: 1, total: 3 },
        updatedAt: NOW - 20 * 60_000,
      },
    ],
    studio: DEMO_STUDIO_STATUS,
  },
};

const DEMO_PLAN_VIEWS: Record<string, PlanRes> = {
  'req-decision': {
    view: {
      planRef: 'req-decision',
      draftRev: 1,
      title: '登录页改版与一键登录',
      goal: '按设计稿完成登录页改版并支持微信一键登录。',
      stage: 'drafting',
      waitingOn: 'customer',
      headline: '等你回答 1 个问题',
      progress: { done: 0, total: 3 },
      milestones: [
        { ref: 'm1', title: '核对设计稿与接口', status: 'planned', criteria: ['确认登录方式'], tasks: [] },
      ],
      activity: [],
      decisions: [
        {
          decisionId: 'dec-1',
          question: '登录失败超过 5 次时，需要图形验证码还是短信验证码？',
          options: [
            { id: 'sms', label: '短信验证码' },
            { id: 'captcha', label: '图形验证码' },
          ],
          multi: false,
          open: true,
        },
      ],
      turns: [],
      typing: false,
      moreTurns: false,
    },
    updatedAt: NOW - 2 * 60_000,
  },
  'req-review': {
    view: {
      planRef: 'req-review',
      draftRev: 2,
      title: '订单导出增加筛选条件',
      goal: '支持按时间范围与订单状态导出 CSV。',
      stage: 'awaiting-review',
      waitingOn: 'customer',
      headline: '等你验收第 1 步交付',
      progress: { done: 1, total: 2 },
      milestones: [
        { ref: 'm1', title: '导出筛选界面与接口', status: 'review', criteria: ['预览可导出 CSV'], tasks: [] },
      ],
      activity: [],
      decisions: [],
      turns: [],
      typing: false,
      moreTurns: false,
    },
    updatedAt: NOW - 10 * 60_000,
  },
  'req-changes': {
    view: {
      planRef: 'req-changes',
      draftRev: 3,
      title: '发货通知模板消息',
      goal: '发货后自动发送模板消息给客户。',
      stage: 'running',
      waitingOn: 'customer',
      headline: '等你确认计划改动',
      progress: { done: 1, total: 3 },
      milestones: [
        { ref: 'm1', title: '消息模板接入', status: 'working', criteria: ['发送回执正常'], tasks: [] },
      ],
      draftDiff: {
        draftRev: 3,
        added: [{ kind: 'milestone', title: '失败重试与告警' }],
        changed: [],
        removed: [],
      },
      activity: [],
      decisions: [],
      turns: [],
      typing: false,
      moreTurns: false,
    },
    updatedAt: NOW - 20 * 60_000,
  },
  'req-confirm': {
    view: {
      planRef: 'req-confirm',
      draftRev: 1,
      title: '支付对账异常提示',
      goal: '对账出现差额时在后台标红并通知。',
      stage: 'drafting',
      waitingOn: 'customer',
      headline: '等你批准开工',
      progress: { done: 0, total: 2 },
      milestones: [
        { ref: 'm1', title: '对账比对逻辑', status: 'planned', criteria: ['差额自动标红'], tasks: [] },
        { ref: 'm2', title: '异常通知卡片', status: 'planned', criteria: ['通知可点开详情'], tasks: [] },
      ],
      activity: [],
      decisions: [],
      turns: [],
      typing: false,
      moreTurns: false,
    },
    updatedAt: NOW - 5 * 60_000,
  },
};

const DEMO_TURNS: TurnsRes = {
  turns: [
    { id: 't1', who: 'customer', text: '把登录页按新设计稿改一下，加上一键登录。', at: NOW - 3600_000 },
    { id: 't2', who: 'ai', text: '已收到设计稿和需求说明，下面是我们的理解与计划。', at: NOW - 2400_000 },
  ],
  more: false,
};

/**
 * `EXPO_PUBLIC_DEMO=1` 时使用的离线演示 Hub（SS-115 / SS-146）：
 * 按不同 `planRef` 返回待答问题、待验收里程碑、草稿改动、待确认计划四类视图，
 * 不发起任何 `fetch` 或 `WebSocket` 请求。
 */
export function createDemoHub(): Hub {
  return {
    async requestLink() {
      return { ok: true, value: undefined };
    },
    async verify() {
      return {
        ok: true,
        value: {
          session: 'demo-session',
          expiresAt: NOW + 7 * 86_400_000,
          customerId: 'cust-demo',
        },
      };
    },
    async logout() {
      return { ok: true, value: undefined };
    },
    async projects() {
      return { ok: true, value: DEMO_PROJECTS };
    },
    async plans(pid) {
      return {
        ok: true,
        value: DEMO_PLANS[pid] ?? { plans: [], studio: DEMO_STUDIO_STATUS },
      };
    },
    async plan(_pid, ref) {
      const hit = DEMO_PLAN_VIEWS[ref] ?? DEMO_PLAN_VIEWS['req-confirm']!;
      return {
        ok: true,
        value: {
          ...hit,
          view: { ...hit.view, planRef: ref },
        },
      };
    },
    async turns() {
      return { ok: true, value: DEMO_TURNS };
    },
    async send(_pid, action) {
      return {
        ok: true,
        value: {
          t: 'receipt',
          opId: action.opId,
          state: 'done',
        },
      };
    },
    watch(_pid, handlers) {
      handlers.state('open');
      return () => {};
    },
  };
}
