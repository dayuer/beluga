/** P12 结果抽屉与四个页签文案（SS-49 / SS-50 / SS-51 / SS-52 / SS-182）。 */

import type { Lang } from './index.js';

export const zh = {
  'drawer.title': '结果与详情',
  'drawer.close': '关闭',
  'drawer.tab.plan': '计划',
  'drawer.tab.outputs': '成果',
  'drawer.tab.changes': '改动',
  'drawer.tab.preview': '预览',

  'outputs.round': '第 {n} 轮',
  'outputs.attachments': '你提供的资料',
  'outputs.kind.preview': '在线预览',
  'outputs.kind.build': '安装包',
  'outputs.kind.screenshot': '界面截图',
  'outputs.kind.note': '说明文档',
  'outputs.kind.attachment': '文件',
  'outputs.open': '打开',
  'outputs.emptyReason': '还没有可查看的成果',
  'outputs.emptyWhen': 'AI 完成本轮开发并检查通过后，安装包、截图和文件会出现在这里',

  'changes.pendingHint': '有尚未确认的改动，请回到卡片区确认或退回。',
  'changes.added': '新增',
  'changes.modified': '修改',
  'changes.removed': '移除',
  'changes.milestonePrefix': '第 {n} 步 · ',
  'changes.emptyReason': '还没有改动记录',
  'changes.emptyWhen': '需求推进过程中调整计划或功能后，改动明细会列在这里',

  'preview.readyTitle': '测试环境已就绪',
  'preview.readyDesc': '可以在手机浏览器里直接体验当前版本，或下载安装包到真机查看。',
  'preview.openBrowser': '在浏览器中打开',
  'preview.downloadBuild': '下载安装包',
  'preview.deployingReason': '测试环境还在部署中',
  'preview.deployingWhen': '通常需要几分钟，部署好后这里会出现打开按钮',
  'preview.unconfiguredReason': '尚未配置测试环境',
  'preview.unconfiguredWhen': '这个项目还没有测试环境，做完后会在这里出现预览',

  'request.openResults': '结果与计划',
  'request.stepsTitle': '当前进度',
  'request.chatSection': '需求对话',
  'request.signedCard.start': '批准开工',
  'request.signedCard.changes': '批准改动',
  'request.signedCard.delivery': '验收交付',
  'request.signedCard.release': '批准上线',
  'request.signedCard.generic': '待你确认',
  'request.signedCardBody': '此操作需要这台设备确认，将在签名能力就绪后开放。',
  'request.unknownTitle': '暂不支持的卡片',
  'request.unknownBody': '当前版本暂不支持展示此类内容。',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'drawer.title': 'Results & details',
  'drawer.close': 'Close',
  'drawer.tab.plan': 'Plan',
  'drawer.tab.outputs': 'Outputs',
  'drawer.tab.changes': 'Changes',
  'drawer.tab.preview': 'Preview',

  'outputs.round': 'Round {n}',
  'outputs.attachments': 'Your attachments',
  'outputs.kind.preview': 'Live preview',
  'outputs.kind.build': 'Installer',
  'outputs.kind.screenshot': 'Screenshot',
  'outputs.kind.note': 'Notes',
  'outputs.kind.attachment': 'File',
  'outputs.open': 'Open',
  'outputs.emptyReason': 'No outputs yet',
  'outputs.emptyWhen': 'Builds, screenshots, and files will show up here once a round finishes',

  'changes.pendingHint': 'There are unconfirmed changes — review them in the cards.',
  'changes.added': 'Added',
  'changes.modified': 'Changed',
  'changes.removed': 'Removed',
  'changes.milestonePrefix': 'Step {n} · ',
  'changes.emptyReason': 'No changes recorded yet',
  'changes.emptyWhen': 'Any adjustments to the plan or scope will be listed here',

  'preview.readyTitle': 'Test environment is ready',
  'preview.readyDesc': 'Try the current build in your browser or download the installer.',
  'preview.openBrowser': 'Open in browser',
  'preview.downloadBuild': 'Download installer',
  'preview.deployingReason': 'Test environment is deploying',
  'preview.deployingWhen': 'Usually takes a few minutes; the preview link will appear here once live',
  'preview.unconfiguredReason': 'Test environment not configured',
  'preview.unconfiguredWhen': 'This project does not have a test environment yet. A preview will appear here once ready.',

  'request.openResults': 'Results & plan',
  'request.stepsTitle': 'Current progress',
  'request.chatSection': 'Conversation',
  'request.signedCard.start': 'Approve start',
  'request.signedCard.changes': 'Approve changes',
  'request.signedCard.delivery': 'Review delivery',
  'request.signedCard.release': 'Approve release',
  'request.signedCard.generic': 'Needs your confirmation',
  'request.signedCardBody': 'This action requires device confirmation and will be enabled once signing is ready.',
  'request.unknownTitle': 'Unsupported card',
  'request.unknownBody': 'This version cannot display this card yet.',
};

export type DrawerKey = keyof typeof zh;

const table: Record<Lang, Record<DrawerKey, string>> = { zh, en };

export function tDrawer(lang: Lang, key: DrawerKey, vars?: Record<string, string | number>): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
