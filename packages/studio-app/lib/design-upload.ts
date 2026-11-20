import { useEffect, useState } from 'react';
import { createPackageUploader, type PackageUploader } from './upload';
import { computeUploadProgress, type UploadProgress, type UploadSessionRecord } from './upload-state';

/**
 * 设计稿包上传的共用实例与只读摘要（SS-88）。
 *
 * 上传在后台继续（切页、切后台都不中断，lib/upload 自己处理断网恢复与回前台续传），
 * 提需求页与需求详情读到同一份状态：提需求页显示进度，需求详情把它画成一张设计稿卡。
 */

let shared: PackageUploader | null = null;

/** 全 App 只有一个上传器（一份持久化会话），提需求页与需求详情共用。 */
export function designUploader(): PackageUploader {
  if (!shared) shared = createPackageUploader();
  return shared;
}

export interface DesignPackageInfo {
  readonly name: string;
  readonly projectId: string;
  readonly fileCount: number;
  readonly imageCount: number;
  readonly specCount: number;
  readonly totalBytes: number;
  readonly progress: number;
  readonly status: UploadProgress['status'];
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);
const SPEC_EXT = new Set(['json', 'pdf', 'fig', 'sketch']);

const extOf = (path: string): string => {
  const last = path.split('/').pop() ?? path;
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
};

/** 上传会话 → 设计稿卡要的那几个数；没有会话（或已清掉）返回 null。 */
export function designPackageInfo(state: UploadSessionRecord | null): DesignPackageInfo | null {
  if (!state) return null;
  let imageCount = 0;
  let specCount = 0;
  for (const file of state.files) {
    const ext = extOf(file.path);
    if (IMAGE_EXT.has(ext)) imageCount += 1;
    else if (SPEC_EXT.has(ext)) specCount += 1;
  }
  const progress = computeUploadProgress(state);
  return {
    name: state.name,
    projectId: state.projectId,
    fileCount: state.files.length,
    imageCount,
    specCount,
    totalBytes: progress.totalBytes,
    progress: progress.fraction,
    status: progress.status,
  };
}

export interface DesignUpload {
  readonly uploader: PackageUploader;
  readonly info: DesignPackageInfo | null;
}

/** 订阅上传进度：每次收到分片、暂停、完成都会重新渲染。 */
export function useDesignUpload(): DesignUpload {
  const uploader = designUploader();
  const [state, setState] = useState<UploadSessionRecord | null>(() => uploader.machine.getState());
  useEffect(() => {
    setState(uploader.machine.getState());
    return uploader.subscribe((_progress, record) => setState(record));
  }, [uploader]);
  return { uploader, info: designPackageInfo(state) };
}
