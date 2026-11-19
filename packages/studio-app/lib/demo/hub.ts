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
        planRef: 'req-login',
        title: '登录页改版与一键登录',
        headline: '等你批准开工',
        stage: 'awaiting-start',
        waitingOn: 'customer',
        progress: { done: 1, total: 4 },
        updatedAt: NOW - 3 * 60_000,
      },
      {
        planRef: 'req-pay',
        title: '支付对账异常提示',
        headline: 'AI 正在编写对账校验（第 2/4 步）',
        stage: 'running',
        waitingOn: 'ai',
        progress: { done: 2, total: 4 },
        updatedAt: NOW - 45 * 60_000,
      },
    ],
    studio: DEMO_STUDIO_STATUS,
  },
  'proj-ops': {
    plans: [
      {
        planRef: 'req-export',
        title: '订单导出增加筛选条件',
        headline: '等你验收第 2 轮交付',
        stage: 'awaiting-review',
        waitingOn: 'customer',
        progress: { done: 3, total: 4 },
        updatedAt: NOW - 15 * 60_000,
      },
    ],
    studio: DEMO_STUDIO_STATUS,
  },
};

const DEMO_PLAN_DETAIL: PlanRes = {
  view: {
    planRef: 'req-login',
    draftRev: 1,
    title: '登录页改版与一键登录',
    goal: '按设计稿完成登录页改版并支持微信一键登录。',
    stage: 'awaiting-start',
    waitingOn: 'customer',
    headline: '等你批准开工',
    progress: { done: 1, total: 4 },
    milestones: [
      {
        ref: 'm1',
        title: '核对设计稿与登录接口',
        status: 'passed',
        criteria: ['确认手机号与微信登录接口'],
        tasks: [],
      },
      {
        ref: 'm2',
        title: '实现登录表单与一键登录按钮',
        status: 'planned',
        criteria: ['完成按钮三态与触感反馈'],
        tasks: [],
      },
    ],
    activity: [],
    decisions: [],
    turns: [],
    typing: false,
    moreTurns: false,
  },
  updatedAt: NOW - 3 * 60_000,
};

const DEMO_TURNS: TurnsRes = {
  turns: [
    { id: 't1', who: 'customer', text: '把登录页按新设计稿改一下，加上一键登录。', at: NOW - 3600_000 },
    { id: 't2', who: 'ai', text: '已收到设计稿和需求说明，下面是我们的理解与计划。', at: NOW - 2400_000 },
  ],
  more: false,
};

/**
 * `EXPO_PUBLIC_DEMO=1` 时使用的离线演示 Hub（SS-115）：
 * 所有接口直接从本地假数据返回，不发起任何 `fetch` 或 `WebSocket` 请求。
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
      return {
        ok: true,
        value: {
          ...DEMO_PLAN_DETAIL,
          view: { ...DEMO_PLAN_DETAIL.view, planRef: ref },
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
