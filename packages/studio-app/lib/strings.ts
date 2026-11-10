/**
 * The customer's words. Chinese is the default; every key has an English sentence. Screens never
 * build a sentence from server text: receipts are codes, and the code's sentence lives here.
 *
 * `{name}` slots are filled by `t`. Keep both languages the same set of keys; the `en` type below
 * makes a missing translation a type error.
 */
export type Lang = 'zh' | 'en';

const zh = {
  'common.back': '返回',
  'common.refresh': '刷新',
  'common.retry': '重试',
  'common.loading': '加载中…',
  'common.error': '加载失败。',
  'common.offlineYou': '你已离线 · 上次同步 {ago}',
  'common.studioOffline': '工作室离线 · 上次同步 {ago}',
  'common.studioOnline': '工作室在线 · 刚刚同步',
  'common.queued': '已排队，工作室上线后处理',
  'common.sending': '发送中…',
  'common.submitted': '已提交',
  'common.done': '已处理',

  'login.title': '登录',
  'login.subtitle': '用邮箱接收登录链接。只有被邀请过的邮箱可以登录。',
  'login.email': '邮箱',
  'login.emailPlaceholder': 'you@example.com',
  'login.continue': '继续',
  'login.sending': '发送中…',
  'login.sent': '如果这个邮箱被邀请过，链接已发出。',
  'login.sendAnother': '再发一封',
  'login.invalidLink': '链接已失效，请重新发一封。',
  'login.offline': '没发出去：你现在没有网络。',
  'login.serviceDown': '中台暂时不可用，稍后再试。',

  'projects.title': '项目',
  'projects.active': '进行中',
  'projects.emptyTitle': '还没有项目',
  'projects.emptyBody': '你的工作室会把项目加到这里。',
  'projects.noPlans': '还没有需求',
  'projects.waitingOnYou': '在等你：{line}',
  'projects.loadFailed': '加载失败。',
  'projects.refreshFailed': '刷新失败 · 下拉再试',

  'home.waitingYou': '在等你',
  'home.waitingStudio': '在等工作室',
  'home.working': 'AI 在做',
  'home.empty': '还没有需求。点下面的「新需求」开始。',
  'home.reconnecting': '连接中断，正在重连…',
  'home.reconnected': '已重新连接',
  'home.newRequest': '新需求',

  'new.title': '新需求',
  'new.intro': '描述你想做的，越具体越好。工作室会先拆成里程碑，等你确认。',
  'new.hintTitle': '写得具体一点',
  'new.hint1': '给谁用：自己、家人，还是门店的顾客',
  'new.hint2': '解决什么问题：每天提醒喝水、看统计',
  'new.hint3': '最重要的一件事：先做好提醒，别的以后再说',
  'new.goalLabel': '你想做什么？',
  'new.goalPlaceholder': '例如：做一个能记录每天喝水的 App，有提醒和统计。',
  'new.left': '还剩 {n} 字',
  'new.trimmed': '已截到 4000 字',
  'new.platforms': '在哪些平台？',
  'new.platformIos': 'iOS',
  'new.platformAndroid': 'Android',
  'new.platformMiniprogram': '小程序',
  'new.platformWeb': 'Web',
  'new.restored': '已恢复草稿 · {ago}',
  'new.start': '开始规划',
  'new.submitted': '已提交，等工作室确认',
  'new.queued': '已排队，工作室上线后处理',
  'new.done': '已处理，工作室开始规划了',
  'new.failed': '没发出去：你现在没有网络。文字已保留。',
  'new.retry': '重试',

  'refusal.not-allowed': '这一步现在不能做，刷新后再试。',
  'refusal.bad-args': '内容不完整或格式不对，检查后再试。',
  'refusal.stale': '页面上的内容已经更新了，刷新后再试。',
  'refusal.not-yours': '你没有这个项目的权限。',
  'refusal.already-done': '这一步已经做过了。',
  'refusal.rate-limited': '操作太频繁了，过一会儿再试。',
  'refusal.not-open': '这件事已经关闭了。',
  'refusal.unknown-plan': '这个计划不存在或已被删除。',
  'refusal.offline': '没发出去：你现在没有网络。文字已保留。',
  'refusal.http': '中台暂时不可用。文字已保留，稍后重试。',
  'refusal.expired': '没来得及处理，请重新发送。',

  'time.justNow': '刚刚',
  'time.minutes': '{n} 分钟前',
  'time.hours': '{n} 小时前',
  'time.days': '{n} 天前',
} as const;

export type StringKey = keyof typeof zh;

const en: Record<StringKey, string> = {
  'common.back': 'Back',
  'common.refresh': 'Refresh',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',
  'common.error': "Couldn't load.",
  'common.offlineYou': "You're offline · last synced {ago}",
  'common.studioOffline': 'Studio offline · last synced {ago}',
  'common.studioOnline': 'Studio online · synced just now',
  'common.queued': "Queued. The studio will pick it up when it's back online.",
  'common.sending': 'Sending…',
  'common.submitted': 'Submitted',
  'common.done': 'Received',

  'login.title': 'Sign in',
  'login.subtitle': "We'll email you a sign-in link. Only invited emails can sign in.",
  'login.email': 'Email',
  'login.emailPlaceholder': 'you@example.com',
  'login.continue': 'Continue',
  'login.sending': 'Sending…',
  'login.sent': 'If this email was invited, the link is on its way.',
  'login.sendAnother': 'Send another',
  'login.invalidLink': 'This link has expired. Request a new one.',
  'login.offline': "Not sent: you're offline.",
  'login.serviceDown': 'The service is temporarily unavailable. Try again soon.',

  'projects.title': 'Projects',
  'projects.active': 'Active',
  'projects.emptyTitle': 'No projects yet',
  'projects.emptyBody': 'Your studio will add them here.',
  'projects.noPlans': 'No requests yet',
  'projects.waitingOnYou': 'Waiting on you: {line}',
  'projects.loadFailed': "Couldn't load.",
  'projects.refreshFailed': "Couldn't refresh · pull to try again",

  'home.waitingYou': 'Waiting on you',
  'home.waitingStudio': 'Waiting on the studio',
  'home.working': 'The AI is working',
  'home.empty': 'No requests yet. Tap New request below to start.',
  'home.reconnecting': 'Reconnecting…',
  'home.reconnected': 'Reconnected',
  'home.newRequest': 'New request',

  'new.title': 'New request',
  'new.intro': 'Describe what you want, as specifically as you can. The studio will break it into milestones for you to confirm.',
  'new.hintTitle': 'A few specifics help',
  'new.hint1': "Who it's for: you, your family, or your customers",
  'new.hint2': 'The problem: daily reminders, stats',
  'new.hint3': 'The one thing that matters first',
  'new.goalLabel': 'What do you want to build?',
  'new.goalPlaceholder': 'e.g. An app that tracks my daily water with reminders and stats.',
  'new.left': '{n} characters left',
  'new.trimmed': 'Trimmed to 4,000 characters',
  'new.platforms': 'Which platforms?',
  'new.platformIos': 'iOS',
  'new.platformAndroid': 'Android',
  'new.platformMiniprogram': 'Mini program',
  'new.platformWeb': 'Web',
  'new.restored': 'Draft restored · {ago}',
  'new.start': 'Start planning',
  'new.submitted': 'Submitted. Waiting for the studio.',
  'new.queued': "Queued. The studio will pick it up when it's back online.",
  'new.done': 'Received. The studio has started planning.',
  'new.failed': "Not sent: you're offline. Your text is saved.",
  'new.retry': 'Retry',

  'refusal.not-allowed': "This step isn't available right now. Refresh and try again.",
  'refusal.bad-args': 'Something in this request is incomplete. Check it and try again.',
  'refusal.stale': 'This page is out of date. Refresh and try again.',
  'refusal.not-yours': "You don't have access to this project.",
  'refusal.already-done': 'This was already done.',
  'refusal.rate-limited': 'Too many actions. Try again in a little while.',
  'refusal.not-open': 'This is no longer open.',
  'refusal.unknown-plan': "This plan doesn't exist or was removed.",
  'refusal.offline': "Not sent: you're offline. Your text is saved.",
  'refusal.http': 'The service is temporarily unavailable. Your text is saved.',
  'refusal.expired': "It wasn't processed in time. Send it again.",

  'time.justNow': 'just now',
  'time.minutes': '{n} min ago',
  'time.hours': '{n} h ago',
  'time.days': '{n} d ago',
};

const table: Record<Lang, Record<StringKey, string>> = { zh, en };

/** Fill `{name}` slots; an unknown slot is left as written so a missed key is visible, not blank. */
export function t(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Chinese first: the product is made for Chinese-speaking clients, and `en` is always there. */
export function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'zh';
  const language = (navigator.language || '').toLowerCase();
  return language.startsWith('zh') ? 'zh' : 'en';
}

export { zh, en };
