import { File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';
import { registerBoot } from './boot';

/**
 * 原生本地键值存储：将非敏感草稿与接口缓存保存在单个 JSON 文件（synon-studio.json）中，
 * 启动时通过 registerBoot 异步补水到内存，对外保持同步 get/set/remove/clear 接口，写入防抖落盘。
 */
const file = (): File => new File(Paths.document, 'synon-studio.json');
let memo: Record<string, unknown> | undefined;
let hydrated = false;
let clearedBeforeHydrate = false;
const removedBeforeHydrate = new Set<string>();
let dirty = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  let loaded: Record<string, unknown> = {};
  try {
    const f = file();
    if (f.exists) {
      const raw = await f.text();
      loaded = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    }
  } catch {
    loaded = {};
  }
  if (clearedBeforeHydrate) {
    memo = { ...(memo ?? {}) };
  } else {
    const merged: Record<string, unknown> = { ...loaded, ...(memo ?? {}) };
    for (const key of removedBeforeHydrate) {
      delete merged[key];
    }
    memo = merged;
  }
  hydrated = true;
}

registerBoot(hydrate);

function all(): Record<string, unknown> {
  if (!memo) memo = {};
  return memo;
}

function writeNow(): void {
  if (!dirty) return;
  dirty = false;
  try {
    const f = file();
    if (!f.exists) f.create();
    f.write(JSON.stringify(memo ?? {}));
  } catch {
    // 磁盘满等异常只影响缓存持久化，不崩溃。
  }
}

function scheduleFlush(): void {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    writeNow();
  }, 1500);
}

if (typeof AppState?.addEventListener === 'function') {
  AppState.addEventListener('change', (next) => {
    if (next === 'background') {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      writeNow();
    }
  });
}

export const kv = {
  get<T>(key: string): T | undefined {
    return all()[key] as T | undefined;
  },
  set(key: string, value: unknown): void {
    if (!hydrated) removedBeforeHydrate.delete(key);
    all()[key] = value;
    scheduleFlush();
  },
  remove(key: string): void {
    if (!hydrated) removedBeforeHydrate.add(key);
    delete all()[key];
    scheduleFlush();
  },
  clear(): void {
    if (!hydrated) {
      clearedBeforeHydrate = true;
      removedBeforeHydrate.clear();
    }
    memo = {};
    scheduleFlush();
  },
};
