import * as ImagePicker from 'expo-image-picker';
import type { Lang } from './strings';
import { tMedia } from './strings/media';

export const MAX_LONG_EDGE = 2048;

export interface MediaAttachment {
  readonly id: string;
  readonly uri: string;
  readonly width: number;
  readonly height: number;
  readonly fileName?: string;
  readonly mimeType?: string;
}

export type MediaPickResult =
  | { readonly ok: true; readonly items: readonly MediaAttachment[] }
  | {
      readonly ok: false;
      readonly reason: 'denied' | 'cancelled' | 'error';
      readonly message: string;
    };

/** 把图片尺寸按比例缩放到长边不超过 `maxEdge`（默认 2048）。 */
export function fitLongEdge(
  width: number,
  height: number,
  maxEdge = MAX_LONG_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

function mapAsset(asset: ImagePicker.ImagePickerAsset, index: number): MediaAttachment {
  const scaled = fitLongEdge(asset.width ?? 0, asset.height ?? 0, MAX_LONG_EDGE);
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    uri: asset.uri,
    width: scaled.width,
    height: scaled.height,
    fileName: asset.fileName ?? undefined,
    mimeType: asset.mimeType ?? undefined,
  };
}

/** 拍照并按长边 2048 归一化尺寸；拒绝相机权限时返回原地说明。 */
export async function takePhoto(lang: Lang): Promise<MediaPickResult> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, reason: 'denied', message: tMedia(lang, 'media.cameraDenied') };
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      exif: false,
    });
    if (res.canceled || res.assets.length === 0) {
      return { ok: false, reason: 'cancelled', message: '' };
    }
    return { ok: true, items: res.assets.map(mapAsset) };
  } catch {
    return {
      ok: false,
      reason: 'error',
      message: tMedia(lang, 'media.cameraError'),
    };
  }
}

/** 从相册多选并按长边 2048 归一化尺寸；拒绝相册权限时返回原地说明。 */
export async function pickPhotos(lang: Lang): Promise<MediaPickResult> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, reason: 'denied', message: tMedia(lang, 'media.libraryDenied') };
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.85,
      exif: false,
    });
    if (res.canceled || res.assets.length === 0) {
      return { ok: false, reason: 'cancelled', message: '' };
    }
    return { ok: true, items: res.assets.map(mapAsset) };
  } catch {
    return {
      ok: false,
      reason: 'error',
      message: tMedia(lang, 'media.libraryError'),
    };
  }
}
