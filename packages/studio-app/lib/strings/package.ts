import type { Lang } from './table';

/**
 * 设计稿包清单确认抽屉文案（SS-160）：中英双语。
 * 独立于 lib/strings/table.ts，方便多任务并行合流。
 */

export const zh = {
  'package.title': '确认清单',
  'package.titleWithName': '确认清单 · {name}',
  'package.confirm': '开始上传',
  'package.cancel': '取消',
  'package.summary': '已选 {selected} / {total} 个文件 · {size}',
  'package.warnTooManyFiles': '已选文件数超过 {max} 个上限',
  'package.warnTooLarge': '已选总大小超过 {max} 上限',
  'package.issue.fileTooLarge': '超过单文件 25 MB 上限',
  'package.issue.unsupportedType': '不支持的文件类型',
  'package.issue.emptyFile': '空文件无法上传',
  'package.issue.encryptedEntry': '已加密条目，已跳过',
  'package.issue.unsupportedCompression': '不支持的压缩方式，已跳过',
  'package.issue.secretFile': '疑似密钥或凭证，已跳过',
} as const;

export type PackageStringKey = keyof typeof zh;

export const en: Record<PackageStringKey, string> = {
  'package.title': 'Review files',
  'package.titleWithName': 'Review files · {name}',
  'package.confirm': 'Upload',
  'package.cancel': 'Cancel',
  'package.summary': '{selected} of {total} files selected · {size}',
  'package.warnTooManyFiles': 'Selected files exceed the {max} file limit',
  'package.warnTooLarge': 'Selected size exceeds the {max} limit',
  'package.issue.fileTooLarge': 'Exceeds 25 MB file limit',
  'package.issue.unsupportedType': 'Unsupported file type',
  'package.issue.emptyFile': 'Empty file cannot be uploaded',
  'package.issue.encryptedEntry': 'Encrypted entry, skipped',
  'package.issue.unsupportedCompression': 'Unsupported compression method, skipped',
  'package.issue.secretFile': 'Possible secret or credential, skipped',
};

const tables: Record<Lang, Record<PackageStringKey, string>> = { zh, en };

export function packageT(
  lang: Lang,
  key: PackageStringKey,
  vars?: Record<string, string | number>,
): string {
  let template = tables[lang][key] ?? zh[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      template = template.replaceAll(`{${k}}`, String(v));
    }
  }
  return template;
}
