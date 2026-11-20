import type { Lang } from './table';

export const zh = {
  'media.camera': '拍照',
  'media.library': '从相册选',
  'media.removeLabel': '移除附件',
  'media.removedNamed': '已移除「{name}」',
  'media.removedUnnamed': '已移除图片',
  'media.cameraDenied': '未开启相机权限。请在系统「设置 › Synon Studio › 相机」中允许访问后再试。',
  'media.libraryDenied': '未开启相册权限。请在系统「设置 › Synon Studio › 照片」中允许访问后再试。',
  'media.cameraError': '暂时无法打开相机，请稍后再试。',
  'media.libraryError': '暂时无法打开相册，请稍后再试。',
} as const;

export type MediaStringKey = keyof typeof zh;

export const en: Record<MediaStringKey, string> = {
  'media.camera': 'Camera',
  'media.library': 'Photos',
  'media.removeLabel': 'Remove attachment',
  'media.removedNamed': 'Removed {name}',
  'media.removedUnnamed': 'Removed attachment',
  'media.cameraDenied': 'Camera permission is off. Enable it in Settings › Synon Studio › Camera to take a photo.',
  'media.libraryDenied': 'Photos permission is off. Enable it in Settings › Synon Studio › Photos to pick images.',
  'media.cameraError': 'Could not open camera.',
  'media.libraryError': 'Could not open photo library.',
};

const table: Record<Lang, Record<MediaStringKey, string>> = { zh, en };

export function tMedia(
  lang: Lang,
  key: MediaStringKey,
  vars?: Record<string, string | number>,
): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
