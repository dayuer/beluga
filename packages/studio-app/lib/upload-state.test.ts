import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system', () => ({
  File: class {},
  Paths: { document: '' },
}));

import {
  buildFileChunks,
  computeMissingChunks,
  createUploadStateMachine,
  type UploadKvStorage,
  type UploadProgress,
} from './upload-state';

function createMemoryKv(): UploadKvStorage {
  const map = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return map.get(key) as T | undefined;
    },
    set(key: string, value: unknown): void {
      map.set(key, JSON.parse(JSON.stringify(value)));
    },
    remove(key: string): void {
      map.delete(key);
    },
  };
}

describe('upload-state', () => {
  it('tracks state transitions, progress subscription, pause/resume, and missing chunks', () => {
    const storage = createMemoryKv();
    const machine = createUploadStateMachine({ storage, now: () => 1000 });
    const events: UploadProgress[] = [];
    const unsubscribe = machine.subscribe((progress) => events.push(progress));

    machine.initSession({
      sessionId: 'up_1',
      projectId: 'proj_1',
      name: 'design.zip',
      chunkSize: 1000,
      files: [
        { path: 'a.png', size: 2500 }, // 3 chunks: 1000, 1000, 500
        { path: 'b.json', size: 500 }, // 1 chunk: 500
      ],
    });
    expect(machine.getProgress()).toMatchObject({
      status: 'idle',
      receivedBytes: 0,
      totalBytes: 3000,
      fraction: 0,
    });

    machine.start();
    machine.markPartReceived(0, 1);
    machine.markPartReceived(0, 2);
    expect(machine.getProgress()).toMatchObject({
      status: 'uploading',
      receivedBytes: 2000,
      totalBytes: 3000,
      completedFiles: 0,
    });

    machine.pause();
    expect(machine.getProgress().status).toBe('paused');

    machine.resume();
    expect(machine.getProgress().status).toBe('uploading');

    // 给定服务端已收块表：file 0 仅收到 part 1，file 1 已收到 part 1
    const missing = machine.reconcileServerParts([
      { fileIndex: 0, parts: [{ partNumber: 1, size: 1000 }] },
      { fileIndex: 1, parts: [{ partNumber: 1, size: 500 }] },
    ]);
    expect(missing).toEqual([
      { fileIndex: 0, partNumber: 2, offset: 1000, size: 1000 },
      { fileIndex: 0, partNumber: 3, offset: 2000, size: 500 },
    ]);
    expect(machine.getProgress()).toMatchObject({
      receivedBytes: 1500,
      completedFiles: 1,
    });

    // 补传缺块并完成
    machine.markPartReceived(0, 2);
    machine.markPartReceived(0, 3);
    machine.complete();
    expect(machine.getProgress()).toMatchObject({
      status: 'done',
      receivedBytes: 3000,
      fraction: 1,
      completedFiles: 2,
    });

    // 取消订阅后不再收到通知
    const countBeforeUnsub = events.length;
    unsubscribe();
    machine.reset();
    expect(events.length).toBe(countBeforeUnsub);
  });

  it('restores identical session state from kv after app restart', () => {
    const storage = createMemoryKv();
    const first = createUploadStateMachine({ storage, now: () => 2000 });
    first.initSession({
      sessionId: 'up_restart',
      projectId: 'proj_2',
      name: 'pack.zip',
      chunkSize: 1024,
      files: [{ path: 'hero.png', size: 2500 }],
    });
    first.start();
    first.markPartReceived(0, 1);
    first.pause();

    const snapshotBefore = first.getState();
    const progressBefore = first.getProgress();

    // 模拟 App 重启：用同一个 kv 创建新状态机实例
    const restarted = createUploadStateMachine({ storage, now: () => 3000 });
    expect(restarted.getState()).toEqual(snapshotBefore);
    expect(restarted.getProgress()).toEqual(progressBefore);
    expect(computeMissingChunks(restarted.getState()!.files)).toEqual([
      { fileIndex: 0, partNumber: 2, offset: 1024, size: 1024 },
      { fileIndex: 0, partNumber: 3, offset: 2048, size: 452 },
    ]);
  });

  it('splits large files into sequential 1-based chunks', () => {
    expect(buildFileChunks(0, 0, 100)).toEqual([]);
    expect(buildFileChunks(2, 250, 100)).toEqual([
      { fileIndex: 2, partNumber: 1, offset: 0, size: 100 },
      { fileIndex: 2, partNumber: 2, offset: 100, size: 100 },
      { fileIndex: 2, partNumber: 3, offset: 200, size: 50 },
    ]);
  });
});
