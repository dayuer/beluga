import type {
  LoginView,
  NewRequestView,
  ReasonSheetView,
  RequestSummary,
  RequestView,
  ResultDrawerView,
  SettingsView,
  StudioCard,
  TodoScreenView,
} from '../views';

/**
 * P1–P12 与跨项目需求列表假数据（SS-115 / SS-147），类型全部来自 `lib/views.ts`。
 * P1–P12 一一对应计划里的屏：
 * - P1 登录
 * - P2 提需求（新需求 / 对做好的提意见）
 * - P3 回答问题（多题编号 + 选项 + 自己写）
 * - P4 需求详情（对话 + 步骤条 + 等待卡 + 卡片流）
 * - P5 交付验收卡
 * - P6 交付流转与预览
 * - P7 原因抽屉（「还不行…」）
 * - P8 待办（「要你做的」+「在等待」）
 * - P9 「我」和它的各个子页
 * - P10 批准开工卡与批准改动卡
 * - P11 批准上线卡
 * - P12 结果抽屉（计划 / 成果 / 改动 / 预览四个页签）
 * - requestsList 跨项目需求列表
 */

export type ScreenStateKind = 'normal' | 'empty' | 'loading' | 'offline' | 'runnerOffline';

export interface DemoScreenState<T> {
  readonly state: ScreenStateKind;
  readonly offline?: boolean;
  readonly loading?: boolean;
  readonly data: T;
}

const NOW = 1_763_600_000_000;

export const DEMO_REQUEST_SUMMARIES: readonly RequestSummary[] = [
  {
    id: 'req-login',
    projectId: 'proj-shop',
    projectName: '优选商城 App',
    title: '登录页改版与一键登录',
    platform: 'ios',
    status: 'needs-you',
    statusLine: '等你批准开工',
    updatedAt: NOW - 3 * 60_000,
    unreadCount: 1,
  },
  {
    id: 'req-export',
    projectId: 'proj-ops',
    projectName: '运营后台',
    title: '订单导出增加筛选条件',
    platform: 'web',
    status: 'needs-you',
    statusLine: '等你验收第 2 轮交付',
    updatedAt: NOW - 15 * 60_000,
  },
  {
    id: 'req-pay',
    projectId: 'proj-shop',
    projectName: '优选商城 App',
    title: '支付对账异常提示',
    platform: 'ios',
    status: 'working',
    statusLine: 'AI 正在编写对账校验（第 2/4 步）',
    updatedAt: NOW - 45 * 60_000,
  },
  {
    id: 'req-push',
    projectId: 'proj-shop',
    projectName: '优选商城 App',
    title: '发货通知模板消息',
    platform: 'miniprogram',
    status: 'waiting',
    statusLine: '等待：执行机器暂时离线',
    waitReason: 'offline',
    updatedAt: NOW - 2 * 3600_000,
  },
  {
    id: 'req-cert',
    projectId: 'proj-ops',
    projectName: '运营后台',
    title: '正式环境自动上线',
    platform: 'web',
    status: 'error',
    statusLine: '需要你处理：正式环境交付令牌已过期',
    errorAction: '前往「设置 › 代码交付」更新令牌',
    updatedAt: NOW - 4 * 3600_000,
  },
  {
    id: 'req-home',
    projectId: 'proj-shop',
    projectName: '优选商城 App',
    title: '首页轮播图圆角调整',
    platform: 'ios',
    status: 'done',
    statusLine: '已通过并上线 1.8.2',
    updatedAt: NOW - 24 * 3600_000,
  },
];

export const DEMO_CARDS: Record<string, StudioCard> = {
  design: {
    id: 'card-design-1',
    kind: 'design',
    createdAt: NOW - 3600_000,
    status: 'done',
    fileCount: 18,
    totalBytes: 4_820_000,
    imageCount: 14,
    specCount: 4,
    skipped: [{ name: '.env.local', reason: '像密钥的文件已跳过' }],
    manifestUrl: 'https://demo.synon.invalid/design/manifest.json',
  },
  question: {
    id: 'card-question-1',
    kind: 'question',
    createdAt: NOW - 3000_000,
    status: 'pending',
    index: 1,
    total: 2,
    prompt: '登录失败超过 5 次时，需要图形验证码还是短信验证码？',
    options: [
      { id: 'opt-sms', label: '短信验证码', description: '与现有注册流程一致' },
      { id: 'opt-captcha', label: '图形验证码' },
    ],
    allowFreeText: true,
    questions: [
      {
        id: 'q1',
        index: 1,
        prompt: '登录失败超过 5 次时，需要图形验证码还是短信验证码？',
        options: [
          { id: 'opt-sms', label: '短信验证码', description: '与现有注册流程一致' },
          { id: 'opt-captcha', label: '图形验证码' },
        ],
        allowFreeText: true,
      },
      {
        id: 'q2',
        index: 2,
        prompt: '未注册手机号一键登录时是否自动创建账号？',
        options: [
          { id: 'opt-auto', label: '自动创建并登录' },
          { id: 'opt-bind', label: '先引导绑定已有账号' },
        ],
        allowFreeText: true,
      },
    ],
  },
  understanding: {
    id: 'card-understanding-1',
    kind: 'understanding',
    createdAt: NOW - 2400_000,
    status: 'pending',
    points: [
      '保留手机号 + 验证码登录，新增微信一键登录入口',
      '沿用「规范 框架与 VI」的圆角与按钮高度',
      '登录态有效期保持 30 天',
    ],
    outOfScope: ['本次不做 Apple 登录'],
    requiresSignature: true,
  },
  start: {
    id: 'card-start-1',
    kind: 'start',
    createdAt: NOW - 1800_000,
    status: 'pending',
    planTitle: '登录页改版与一键登录',
    stepCount: 4,
    estimateLabel: '预计约 2 小时',
    requiresSignature: true,
  },
  steps: {
    id: 'card-steps-1',
    kind: 'steps',
    createdAt: NOW - 1200_000,
    status: 'pending',
    steps: [
      { id: 's1', title: '核对设计稿与登录接口', status: 'done' },
      { id: 's2', title: '实现登录表单与一键登录按钮', status: 'active' },
      { id: 's3', title: '接入错误提示与触感反馈', status: 'waiting', waitReason: 'queued' },
      { id: 's4', title: '真机截图与预览部署', status: 'todo' },
    ],
  },
  waitOffline: {
    id: 'card-wait-offline',
    kind: 'wait',
    createdAt: NOW - 900_000,
    status: 'pending',
    reason: 'offline',
    message: '执行机器 Mac mini 暂时离线，上线后会自动继续。',
    etaText: '通常几分钟内恢复，你不需要做什么',
  },
  changes: {
    id: 'card-changes-1',
    kind: 'changes',
    createdAt: NOW - 600_000,
    status: 'pending',
    summary: '根据你的反馈补充了密码可见切换开关',
    added: ['密码明文切换按钮'],
    modified: ['登录按钮防连点逻辑'],
    removed: [],
    requiresSignature: true,
  },
  delivery: {
    id: 'card-delivery-1',
    kind: 'delivery',
    createdAt: NOW - 300_000,
    status: 'pending',
    round: 2,
    summary: '第 2 轮交付已部署到测试环境，检查全部通过。',
    criteria: ['记录后列表立刻更新', '关掉 App 再打开数据还在'],
    previewUrl: 'https://demo-preview.synon.invalid/req-export',
    installUrl: 'https://demo-preview.synon.invalid/req-export.ipa',
    screenshots: [],
    requiresSignature: true,
  },
  code: {
    id: 'card-code-1',
    kind: 'code',
    createdAt: NOW - 180_000,
    status: 'done',
    repoUrl: 'https://git.synon.invalid/shop/ios-app',
    prUrl: 'https://git.synon.invalid/shop/ios-app/pull/42',
    pushState: 'pushed',
  },
  release: {
    id: 'card-release-1',
    kind: 'release',
    createdAt: NOW - 60_000,
    status: 'pending',
    envId: 'prod',
    envTitle: '正式环境',
    version: '1.8.3',
    lastVersion: '1.8.2',
    lastReleaseAt: NOW - 24 * 3600_000,
    requiresSignature: true,
  },
};

export const DEMO_RESULT_DRAWER: ResultDrawerView = {
  artifacts: [
    { id: 'a1', round: 2, kind: 'preview', title: '测试环境在线预览', url: 'https://demo-preview.synon.invalid/req-export', createdAt: NOW - 300_000 },
    { id: 'a2', round: 2, kind: 'build', title: 'iOS 测试安装包 1.8.3', url: 'https://demo-preview.synon.invalid/req-export.ipa', createdAt: NOW - 300_000 },
  ],
  attachments: [{ id: 'att1', name: '登录页设计稿.zip', kind: 'design' }],
  plan: {
    milestones: [
      { id: 'm1', title: '核对设计稿与登录接口', status: 'done' },
      { id: 'm2', title: '实现登录表单与一键登录按钮', status: 'active' },
      { id: 'm3', title: '真机截图与预览部署', status: 'todo' },
    ],
    activity: [
      { id: 'act1', text: 'AI 完成设计稿清单解析（18 个文件）', at: NOW - 3500_000 },
      { id: 'act2', text: '客户确认需求理解', at: NOW - 2000_000 },
    ],
  },
  changes: {
    added: ['密码明文切换按钮'],
    modified: ['登录按钮防连点逻辑'],
    removed: [],
    pendingApproval: true,
  },
  previewUrl: 'https://demo-preview.synon.invalid/req-export',
};

export const DEMO_REQUEST_VIEW: RequestView = {
  summary: DEMO_REQUEST_SUMMARIES[0]!,
  messages: [
    { id: 'm1', role: 'customer', text: '把登录页按新设计稿改一下，加上一键登录。', createdAt: NOW - 3600_000 },
    { id: 'm2', role: 'ai', text: '已收到设计稿和需求说明，下面是我们的理解与计划。', createdAt: NOW - 2400_000 },
  ],
  cards: [
    DEMO_CARDS.design!,
    DEMO_CARDS.question!,
    DEMO_CARDS.understanding!,
    DEMO_CARDS.start!,
    DEMO_CARDS.steps!,
    DEMO_CARDS.waitOffline!,
    DEMO_CARDS.changes!,
    DEMO_CARDS.delivery!,
    DEMO_CARDS.code!,
    DEMO_CARDS.release!,
  ],
  activeCardId: DEMO_CARDS.start!.id,
  results: DEMO_RESULT_DRAWER,
};

export const DEMO_SETTINGS_VIEW: SettingsView = {
  projects: [
    { id: 'proj-shop', name: '优选商城 App', platform: 'ios', runMode: 'auto-delivery', prodEnabled: true },
    { id: 'proj-ops', name: '运营后台', platform: 'web', runMode: 'every-step', prodEnabled: true },
  ],
  envs: {
    'proj-shop': [
      {
        id: 'test',
        title: '测试',
        protected: false,
        target: { platform: 'ios', appId: 'com.shop.***', mode: 'TestFlight 内测' },
        vars: [{ name: 'API_BASE', value: 'https://test-api.shop.invalid', at: NOW - 86_400_000, by: { name: '张敏', via: 'studio' } }],
        secrets: [{ name: 'APPLE_API_KEY', purpose: 'TestFlight 上传密钥', at: NOW - 86_400_000, by: { name: '张敏', via: 'studio' } }],
      },
      {
        id: 'prod',
        title: '正式',
        protected: true,
        target: { platform: 'ios', appId: 'com.shop.***', mode: 'App Store' },
        vars: [{ name: 'API_BASE', value: 'https://api.shop.invalid', at: NOW - 172_800_000, by: { name: '张敏', via: 'studio' } }],
        secrets: [{ name: 'APP_STORE_KEY', purpose: '正式发布签名密钥', at: NOW - 100 * 86_400_000, by: { name: '运维配置', via: 'setup' }, staleDays: 100 }],
        lastRelease: { version: '1.8.2', at: NOW - 24 * 3600_000, by: { name: '张敏', via: 'studio' } },
      },
    ],
  },
  forges: [
    { projectId: 'proj-shop', mode: 'push-mine', repoUrl: 'https://git.synon.invalid/shop/ios-app', hasToken: true, tokenUpdatedAt: NOW - 86_400_000 },
  ],
  runners: [
    { id: 'runner-1', name: '工作室 Mac mini', online: true, accepting: true, activeRequestCount: 2, monthlyQuotaUsed: 42, monthlyQuotaLimit: 100 },
    { id: 'runner-2', name: '备用构建机', online: false, accepting: false, activeRequestCount: 0 },
  ],
  devices: [
    { id: 'dev-1', name: 'iPhone 15 Pro', platform: 'ios', registeredAt: NOW - 7 * 86_400_000, lastSeenAt: NOW - 60_000, isCurrent: true },
    { id: 'dev-2', name: 'MacBook Pro', platform: 'mac', registeredAt: NOW - 14 * 86_400_000, lastSeenAt: NOW - 3600_000 },
  ],
  account: {
    email: 'customer@shop.invalid',
    pushEnabled: true,
    appearance: 'light',
  },
};

const EMPTY_REQUEST_VIEW: RequestView = {
  summary: {
    id: 'req-empty',
    projectId: 'proj-shop',
    projectName: '优选商城 App',
    title: '新需求',
    platform: 'ios',
    status: 'working',
    statusLine: '正在准备需求单',
    updatedAt: NOW,
  },
  messages: [],
  cards: [],
  results: {
    artifacts: [],
    attachments: [],
    plan: { milestones: [], activity: [] },
    changes: { added: [], modified: [], removed: [], pendingApproval: false },
  },
};

const RUNNER_OFFLINE_VIEW: RequestView = {
  ...DEMO_REQUEST_VIEW,
  summary: DEMO_REQUEST_SUMMARIES[3]!,
  cards: [DEMO_CARDS.steps!, DEMO_CARDS.waitOffline!],
};

/** P1–P12 与跨项目需求列表的多状态假数据（normal / empty / loading / offline / runnerOffline）。 */
export const DEMO_SCREENS = {
  // P1: 登录
  P1: {
    normal: { state: 'normal', data: { email: 'customer@shop.invalid', inviteId: 'inv-demo', sent: false } satisfies LoginView },
    empty: { state: 'empty', data: { email: '', inviteId: null, sent: false } satisfies LoginView },
    loading: { state: 'loading', loading: true, data: { email: 'customer@shop.invalid', inviteId: 'inv-demo', sent: true } satisfies LoginView },
    offline: { state: 'offline', offline: true, data: { email: 'customer@shop.invalid', inviteId: null, sent: false } satisfies LoginView },
    runnerOffline: { state: 'runnerOffline', data: { email: 'customer@shop.invalid', inviteId: 'inv-demo', sent: true } satisfies LoginView },
  },
  // P2: 提需求（新需求 / 对做好的提意见）
  P2: {
    normal: {
      state: 'normal',
      data: {
        mode: 'new',
        projects: DEMO_SETTINGS_VIEW.projects.map((p) => ({ id: p.id, name: p.name, platform: p.platform })),
        completedRequests: DEMO_REQUEST_SUMMARIES.filter((r) => r.status === 'done'),
        examples: ['登录页增加微信一键登录', '导出订单支持按时间筛选'],
      } satisfies NewRequestView,
    },
    empty: {
      state: 'empty',
      data: { mode: 'new', projects: [], completedRequests: [], examples: [] } satisfies NewRequestView,
    },
    loading: {
      state: 'loading',
      loading: true,
      data: { mode: 'new', projects: [], completedRequests: [], examples: [] } satisfies NewRequestView,
    },
    offline: {
      state: 'offline',
      offline: true,
      data: {
        mode: 'feedback',
        projects: DEMO_SETTINGS_VIEW.projects.map((p) => ({ id: p.id, name: p.name, platform: p.platform })),
        completedRequests: DEMO_REQUEST_SUMMARIES.filter((r) => r.status === 'done'),
        examples: [],
      } satisfies NewRequestView,
    },
    runnerOffline: {
      state: 'runnerOffline',
      data: {
        mode: 'new',
        projects: DEMO_SETTINGS_VIEW.projects.map((p) => ({ id: p.id, name: p.name, platform: p.platform })),
        completedRequests: DEMO_REQUEST_SUMMARIES.filter((r) => r.status === 'done'),
        examples: ['登录页增加微信一键登录'],
      } satisfies NewRequestView,
    },
  },
  // P3: 回答问题（多题编号 + 选项 + 自己写）
  P3: {
    normal: { state: 'normal', data: { ...DEMO_REQUEST_VIEW, cards: [DEMO_CARDS.question!] } satisfies RequestView },
    empty: { state: 'empty', data: EMPTY_REQUEST_VIEW },
    loading: { state: 'loading', loading: true, data: EMPTY_REQUEST_VIEW },
    offline: { state: 'offline', offline: true, data: { ...DEMO_REQUEST_VIEW, cards: [DEMO_CARDS.question!] } satisfies RequestView },
    runnerOffline: { state: 'runnerOffline', data: RUNNER_OFFLINE_VIEW },
  },
  // P4: 需求详情（对话 + 步骤条 + 等待卡 + 卡片流）
  P4: {
    normal: { state: 'normal', data: DEMO_REQUEST_VIEW },
    empty: { state: 'empty', data: EMPTY_REQUEST_VIEW },
    loading: { state: 'loading', loading: true, data: EMPTY_REQUEST_VIEW },
    offline: { state: 'offline', offline: true, data: DEMO_REQUEST_VIEW },
    runnerOffline: { state: 'runnerOffline', data: RUNNER_OFFLINE_VIEW },
  },
  // P5: 交付验收卡
  P5: {
    normal: { state: 'normal', data: { ...DEMO_REQUEST_VIEW, cards: [DEMO_CARDS.delivery!] } satisfies RequestView },
    empty: { state: 'empty', data: EMPTY_REQUEST_VIEW },
    loading: { state: 'loading', loading: true, data: EMPTY_REQUEST_VIEW },
    offline: { state: 'offline', offline: true, data: { ...DEMO_REQUEST_VIEW, cards: [DEMO_CARDS.delivery!] } satisfies RequestView },
    runnerOffline: { state: 'runnerOffline', data: RUNNER_OFFLINE_VIEW },
  },
  // P6: 交付流转与预览
  P6: {
    normal: { state: 'normal', data: { ...DEMO_REQUEST_VIEW, cards: [DEMO_CARDS.delivery!, DEMO_CARDS.code!] } satisfies RequestView },
    empty: { state: 'empty', data: EMPTY_REQUEST_VIEW },
    loading: { state: 'loading', loading: true, data: EMPTY_REQUEST_VIEW },
    offline: { state: 'offline', offline: true, data: { ...DEMO_REQUEST_VIEW, cards: [DEMO_CARDS.delivery!, DEMO_CARDS.code!] } satisfies RequestView },
    runnerOffline: { state: 'runnerOffline', data: RUNNER_OFFLINE_VIEW },
  },
  // P7: 原因抽屉（「还不行…」）
  P7: {
    normal: {
      state: 'normal',
      data: {
        requestId: 'req-export',
        title: '哪里还不行？',
        quickTags: ['样式不对', '点不了', '漏了一项'],
        draft: '',
      } satisfies ReasonSheetView,
    },
    empty: {
      state: 'empty',
      data: { requestId: 'req-export', title: '哪里还不行？', quickTags: [], draft: '' } satisfies ReasonSheetView,
    },
    loading: {
      state: 'loading',
      loading: true,
      data: { requestId: 'req-export', title: '哪里还不行？', quickTags: ['样式不对'], draft: '导出按钮位置偏左' } satisfies ReasonSheetView,
    },
    offline: {
      state: 'offline',
      offline: true,
      data: { requestId: 'req-export', title: '哪里还不行？', quickTags: ['样式不对'], draft: '离线草稿已保留' } satisfies ReasonSheetView,
    },
    runnerOffline: {
      state: 'runnerOffline',
      data: { requestId: 'req-export', title: '哪里还不行？', quickTags: ['样式不对'], draft: '' } satisfies ReasonSheetView,
    },
  },
  // P8: 待办（「要你做的」+「在等待」）
  P8: {
    normal: { state: 'normal', data: { needsYou: [DEMO_CARDS.start!, DEMO_CARDS.delivery!], waiting: [DEMO_CARDS.waitOffline!] } satisfies TodoScreenView },
    empty: { state: 'empty', data: { needsYou: [], waiting: [] } satisfies TodoScreenView },
    loading: { state: 'loading', loading: true, data: { needsYou: [], waiting: [] } satisfies TodoScreenView },
    offline: { state: 'offline', offline: true, data: { needsYou: [DEMO_CARDS.start!], waiting: [DEMO_CARDS.waitOffline!] } satisfies TodoScreenView },
    runnerOffline: { state: 'runnerOffline', data: { needsYou: [], waiting: [DEMO_CARDS.waitOffline!] } satisfies TodoScreenView },
  },
  // P9: 「我」和它的各个子页
  P9: {
    normal: { state: 'normal', data: DEMO_SETTINGS_VIEW },
    empty: { state: 'empty', data: { ...DEMO_SETTINGS_VIEW, projects: [], envs: {}, forges: [], runners: [], devices: [] } satisfies SettingsView },
    loading: { state: 'loading', loading: true, data: DEMO_SETTINGS_VIEW },
    offline: { state: 'offline', offline: true, data: DEMO_SETTINGS_VIEW },
    runnerOffline: {
      state: 'runnerOffline',
      data: {
        ...DEMO_SETTINGS_VIEW,
        runners: DEMO_SETTINGS_VIEW.runners.map((r) => ({ ...r, online: false, accepting: false })),
      } satisfies SettingsView,
    },
  },
  // P10: 批准开工卡与批准改动卡
  P10: {
    normal: { state: 'normal', data: { ...DEMO_REQUEST_VIEW, cards: [DEMO_CARDS.start!, DEMO_CARDS.changes!] } satisfies RequestView },
    empty: { state: 'empty', data: EMPTY_REQUEST_VIEW },
    loading: { state: 'loading', loading: true, data: EMPTY_REQUEST_VIEW },
    offline: { state: 'offline', offline: true, data: { ...DEMO_REQUEST_VIEW, cards: [DEMO_CARDS.start!, DEMO_CARDS.changes!] } satisfies RequestView },
    runnerOffline: { state: 'runnerOffline', data: RUNNER_OFFLINE_VIEW },
  },
  // P11: 批准上线卡
  P11: {
    normal: { state: 'normal', data: { ...DEMO_REQUEST_VIEW, cards: [DEMO_CARDS.release!] } satisfies RequestView },
    empty: { state: 'empty', data: EMPTY_REQUEST_VIEW },
    loading: { state: 'loading', loading: true, data: EMPTY_REQUEST_VIEW },
    offline: { state: 'offline', offline: true, data: { ...DEMO_REQUEST_VIEW, cards: [DEMO_CARDS.release!] } satisfies RequestView },
    runnerOffline: { state: 'runnerOffline', data: RUNNER_OFFLINE_VIEW },
  },
  // P12: 结果抽屉（计划 / 成果 / 改动 / 预览四个页签）
  P12: {
    normal: { state: 'normal', data: DEMO_RESULT_DRAWER },
    empty: { state: 'empty', data: EMPTY_REQUEST_VIEW.results },
    loading: { state: 'loading', loading: true, data: EMPTY_REQUEST_VIEW.results },
    offline: { state: 'offline', offline: true, data: DEMO_RESULT_DRAWER },
    runnerOffline: {
      state: 'runnerOffline',
      data: { ...DEMO_RESULT_DRAWER, artifacts: [], previewUrl: undefined } satisfies ResultDrawerView,
    },
  },
  // 跨项目需求列表（供 requests-list 使用）
  requestsList: {
    normal: { state: 'normal', data: DEMO_REQUEST_SUMMARIES },
    empty: { state: 'empty', data: [] as readonly RequestSummary[] },
    loading: { state: 'loading', loading: true, data: [] as readonly RequestSummary[] },
    offline: { state: 'offline', offline: true, data: DEMO_REQUEST_SUMMARIES },
    runnerOffline: { state: 'runnerOffline', data: DEMO_REQUEST_SUMMARIES.filter((r) => r.waitReason === 'offline') },
  },
} as const;
