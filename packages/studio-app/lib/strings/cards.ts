/** 设计稿卡与代码卡文案（SS-46）。 */

export const zh = {
  'designCard.title': '设计稿',
  'designCard.defaultName': '设计稿资源包',
  'designCard.uploading': '上传中 {pct}%',
  'designCard.received': '已收下',
  'designCard.summary': '共 {files} 个文件（图片 {images} · 规范 {specs}）',
  'designCard.skipped': '已跳过 {n} 个无关文件',

  'codeCard.title': '代码交付',
  'codeCard.repo': '仓库',
  'codeCard.pr': '变更记录',
  'codeCard.state.ready': '待推送',
  'codeCard.state.pushed': '已推送',
  'codeCard.state.failed': '推送失败',
  'codeCard.retryPush': '重新推送',
  'codeCard.retrying': '推送中…',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'designCard.title': 'Design package',
  'designCard.defaultName': 'Design assets',
  'designCard.uploading': 'Uploading {pct}%',
  'designCard.received': 'Received',
  'designCard.summary': '{files} files ({images} images · {specs} specs)',
  'designCard.skipped': 'Skipped {n} unrelated files',

  'codeCard.title': 'Code delivery',
  'codeCard.repo': 'Repository',
  'codeCard.pr': 'Pull request',
  'codeCard.state.ready': 'Ready to push',
  'codeCard.state.pushed': 'Pushed',
  'codeCard.state.failed': 'Push failed',
  'codeCard.retryPush': 'Push again',
  'codeCard.retrying': 'Pushing…',
};
