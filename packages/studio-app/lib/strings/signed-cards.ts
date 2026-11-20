import type { Lang } from './index';

/**
 * A5 六张卡（AcceptCard、StartCard、ChangeCard、ReleaseCard、DeliveryCard）与 ReasonSheet 的中英文文案。
 * 独立于公共的 `lib/strings/table.ts`，便于 A5 并行维护。
 */
export const zh = {
  // AcceptCard (P5)
  'accept.roundTitle': (n: number) => `第 ${n} 轮交付`,
  'accept.howToCheck': '怎么看',
  'accept.screenshots': '截图',
  'accept.openPreview': '打开体验版',
  'accept.openInstall': '下载安装包',
  'accept.notYet': '还不行…',
  'accept.approve': '通过',
  'accept.approved': '已通过',
  'accept.pendingUndo': '已通过，10 秒内可撤销',
  'accept.undoText': (n: number) => `已通过第 ${n} 轮交付`,
  'accept.needsYou': '等你验收',

  // ReasonSheet (P7)
  'reason.missingChars': (n: number) => `还差 ${n} 个字（至少 10 个字）`,
  'reason.tagJoiner': '；',

  // StartCard (P10)
  'start.statusPending': '等你确认开工',
  'start.statusDone': '已开工',
  'start.stepsLabel': '步骤',
  'start.stepsCount': (n: number) => `共 ${n} 步`,
  'start.estimateLabel': '大约多久',
  'start.estimateFallback': '以实际进度为准',
  'start.howLabel': '怎么做',
  'start.howFallback': '按已确认的需求与规范逐步推进，每步完成自动检查',
  'start.whenLabel': '什么时候开始',
  'start.whenFallback': '确认后立即开始',
  'start.decline': '先不做…',
  'start.start': '开始做',
  'start.started': '已确认开工',
  'start.pendingUndo': '已确认开工，4 秒内可撤销',
  'start.undoText': (title: string) => `已批准开工「${title}」`,
  'start.openPlan': '在结果区看计划',

  // ChangeCard
  'change.title': '计划改动',
  'change.statusPending': '等你确认改动',
  'change.statusDone': '已确认改动',
  'change.decline': '先不改…',
  'change.approve': '按这个改',
  'change.approved': '已按此改动继续',
  'change.pendingUndo': '已按此改动继续，4 秒内可撤销',
  'change.undoText': '已批准计划改动',

  // ReleaseCard (P11)
  'release.title': (env: string) => `上线到${env}`,
  'release.statusPending': '等你批准上线',
  'release.statusDone': '已上线',
  'release.targetVersion': '要上的版本',
  'release.liveVersion': '线上版本',
  'release.lastReleaseTime': '上次上线时间',
  'release.lastReleasePerson': '上次上线人',
  'release.decline': '先不上…',
  'release.release': '上线',
  'release.released': (version: string) => `已上线 ${version}`,
  'release.confirmTitle': (env: string) => `上线到「${env}」后不能撤销`,
  'release.confirmDesc': (version: string, env: string, live?: string) =>
    `将把 ${version} 发布到${env}${live ? `（当前线上 ${live}）` : ''}。确认后立即生效且无法撤销。`,
  'release.unknown': '—',

  // DeliveryCard
  'delivery.title': (round: number) => `第 ${round} 轮已交付`,
  'delivery.statusDone': '自动交付完成',
  'delivery.checksPassed': '检查全部通过',
  'delivery.merged': '已合并',
  'delivery.previewLabel': '预览地址',
  'delivery.openPreview': '去看看',
} as const;

export type SignedCardStrings = {
  readonly [K in keyof typeof zh]: (typeof zh)[K] extends (...args: infer A) => string ? (...args: A) => string : string;
};

export const en: SignedCardStrings = {
  // AcceptCard (P5)
  'accept.roundTitle': (n: number) => `Delivery round ${n}`,
  'accept.howToCheck': 'What to check',
  'accept.screenshots': 'Screenshots',
  'accept.openPreview': 'Open preview',
  'accept.openInstall': 'Download build',
  'accept.notYet': 'Not yet…',
  'accept.approve': 'Approve',
  'accept.approved': 'Approved',
  'accept.pendingUndo': 'Approved · undo within 10s',
  'accept.undoText': (n: number) => `Approved delivery round ${n}`,
  'accept.needsYou': 'Needs review',

  // ReasonSheet (P7)
  'reason.missingChars': (n: number) => `${n} more character${n === 1 ? '' : 's'} needed (min 10)`,
  'reason.tagJoiner': ', ',

  // StartCard (P10)
  'start.statusPending': 'Waiting to start',
  'start.statusDone': 'Started',
  'start.stepsLabel': 'Steps',
  'start.stepsCount': (n: number) => `${n} steps`,
  'start.estimateLabel': 'Estimated time',
  'start.estimateFallback': 'Depends on scope',
  'start.howLabel': 'How it will run',
  'start.howFallback': 'Follows the confirmed plan step by step with automatic checks',
  'start.whenLabel': 'When it starts',
  'start.whenFallback': 'Immediately after confirmation',
  'start.decline': 'Not now…',
  'start.start': 'Start work',
  'start.started': 'Work started',
  'start.pendingUndo': 'Started · undo within 4s',
  'start.undoText': (title: string) => `Approved start for “${title}”`,
  'start.openPlan': 'View plan in drawer',

  // ChangeCard
  'change.title': 'Planned changes',
  'change.statusPending': 'Review changes',
  'change.statusDone': 'Changes approved',
  'change.decline': 'Not now…',
  'change.approve': 'Apply changes',
  'change.approved': 'Changes approved',
  'change.pendingUndo': 'Applied · undo within 4s',
  'change.undoText': 'Approved planned changes',

  // ReleaseCard (P11)
  'release.title': (env: string) => `Release to ${env}`,
  'release.statusPending': 'Needs release approval',
  'release.statusDone': 'Released',
  'release.targetVersion': 'Version to release',
  'release.liveVersion': 'Current live',
  'release.lastReleaseTime': 'Last release time',
  'release.lastReleasePerson': 'Last released by',
  'release.decline': 'Not now…',
  'release.release': 'Release',
  'release.released': (version: string) => `Released ${version}`,
  'release.confirmTitle': (env: string) => `Releasing to “${env}” cannot be undone`,
  'release.confirmDesc': (version: string, env: string, live?: string) =>
    `This will deploy ${version} to ${env}${live ? ` (currently ${live})` : ''}. It takes effect immediately and cannot be undone.`,
  'release.unknown': '—',

  // DeliveryCard
  'delivery.title': (round: number) => `Round ${round} delivered`,
  'delivery.statusDone': 'Auto-delivered',
  'delivery.checksPassed': 'All checks passed',
  'delivery.merged': 'Merged',
  'delivery.previewLabel': 'Preview URL',
  'delivery.openPreview': 'Take a look',
};

export function signedCardStrings(lang: Lang): SignedCardStrings {
  return lang === 'en' ? en : zh;
}
