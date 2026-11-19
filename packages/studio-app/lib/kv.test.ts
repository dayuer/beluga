import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = { content: '{"draft:proj-1":"hello"}', exists: true };
let resolveRead: ((v: string) => void) | null = null;
const writeSpy = vi.fn((next: string) => {
  disk.content = next;
  disk.exists = true;
});
const createSpy = vi.fn(() => {
  disk.exists = true;
});

vi.mock('expo-file-system', () => ({
  Paths: { document: '/mock-doc' },
  File: class MockFile {
    get exists() {
      return disk.exists;
    }
    text() {
      if (resolveRead) {
        return new Promise<string>((resolve) => {
          resolveRead = resolve;
        });
      }
      return Promise.resolve(disk.content);
    }
    create() {
      createSpy();
    }
    write(data: string) {
      writeSpy(data);
    }
  },
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

describe('kv', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    disk.content = '{"draft:proj-1":"hello"}';
    disk.exists = true;
    resolveRead = null;
    writeSpy.mockClear();
    createSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates on boot and debounces writes to synon-studio.json', async () => {
    const { kv } = await import('./kv');
    await vi.runAllTimersAsync();

    expect(kv.get<string>('draft:proj-1')).toBe('hello');

    kv.set('a', 1);
    kv.set('b', 2);
    expect(kv.get<number>('a')).toBe(1);
    expect(writeSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(disk.content)).toEqual({ 'draft:proj-1': 'hello', a: 1, b: 2 });

    kv.remove('a');
    vi.advanceTimersByTime(1500);
    expect(JSON.parse(disk.content)).toEqual({ 'draft:proj-1': 'hello', b: 2 });
  });

  it('preserves early writes and does not skip disk data on early reads before hydration completes', async () => {
    // 挂起文件读取，模拟补水尚未完成
    let finishRead!: (v: string) => void;
    resolveRead = (v: string) => finishRead(v);
    const { File } = await import('expo-file-system');
    const origText = File.prototype.text;
    File.prototype.text = () =>
      new Promise<string>((resolve) => {
        finishRead = resolve;
      });

    const { kv } = await import('./kv');

    // 补水前同步读取与写入
    expect(kv.get<string>('draft:proj-1')).toBeUndefined();
    kv.set('early', 'kept');

    // 磁盘读完返回
    finishRead('{"draft:proj-1":"from-disk","early":"stale"}');
    await Promise.resolve();
    await Promise.resolve();

    // 磁盘数据没有被跳过，且早写的值不被旧值覆盖
    expect(kv.get<string>('draft:proj-1')).toBe('from-disk');
    expect(kv.get<string>('early')).toBe('kept');

    File.prototype.text = origText;
  });
});
