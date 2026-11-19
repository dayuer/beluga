import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = { content: '{"draft:proj-1":"hello"}', exists: true };
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
    async text() {
      return disk.content;
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
    writeSpy.mockClear();
    createSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates on boot and debounces writes to synon-studio.json', async () => {
    const { kv } = await import('./kv');
    // 等待 registerBoot 的异步 hydrate 完成
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
});
