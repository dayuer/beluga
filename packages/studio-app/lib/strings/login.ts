export const zh = {
  'login.title': '登录',
  'login.subtitle': '用邮箱接收登录链接。只有被邀请过的邮箱可以登录。',
  'login.email': '邮箱',
  'login.emailPlaceholder': 'you@example.com',
  'login.continue': '继续',
  'login.sending': '发送中…',
  'login.verifying': '正在登录…',
  'login.sent': '如果这个邮箱被邀请过，链接已发出。',
  'login.sendAnother': '再发一封',
  'login.invalidLink': '链接已失效，请重新发一封。',
  'login.offline': '没发出去：你现在没有网络。',
  'login.serviceDown': '服务暂时不可用，稍后再试。',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'login.title': 'Sign in',
  'login.subtitle': "We'll email you a sign-in link. Only invited emails can sign in.",
  'login.email': 'Email',
  'login.emailPlaceholder': 'you@example.com',
  'login.continue': 'Continue',
  'login.sending': 'Sending…',
  'login.verifying': 'Signing you in…',
  'login.sent': 'If this email was invited, the link is on its way.',
  'login.sendAnother': 'Send another',
  'login.invalidLink': 'This link has expired. Request a new one.',
  'login.offline': "Not sent: you're offline.",
  'login.serviceDown': 'The service is temporarily unavailable. Try again soon.',
};
