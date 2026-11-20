import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

export interface Undo {
  readonly active: boolean;
  /** Seconds left in the countdown, for the button's "Undo (10s)". */
  readonly remaining: number;
  start(fire: () => void): void;
  cancel(): void;
  flush(): void;
}

export type SubscribeAppState = (listener: (state: string) => void) => () => void;

const defaultSubscribeAppState: SubscribeAppState = (listener) => {
  if (typeof AppState?.addEventListener !== 'function') return () => {};
  const sub = AppState.addEventListener('change', listener);
  return () => sub.remove();
};

export interface UndoController extends Undo {
  dispose(): void;
}

/**
 * 10 秒撤销控制器（纯逻辑，可注入假 AppState 与假时钟做单测）：
 * - 切到后台时不提前 fire，保留原定时器；
 * - 回到 active 时若已过 deadline（后台冻结了定时器），立刻 fire 补发；
 * - 回到 active 时若未过 deadline，按剩余时间重设定时器并更新 remaining；
 * - 组件卸载（dispose）时若仍在倒计时，立刻 flush 发出。
 */
export function createUndoController(
  ms: number,
  onChange: (active: boolean, remaining: number) => void,
  subscribeAppState: SubscribeAppState = defaultSubscribeAppState,
): UndoController {
  let active = false;
  let remaining = Math.ceil(ms / 1000);
  let deadline = 0;
  let fireFn: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;

  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    if (tick) clearInterval(tick);
    timer = null;
    tick = null;
  };

  const emit = () => onChange(active, remaining);

  const fire = () => {
    if (!active) return;
    active = false;
    deadline = 0;
    clearTimers();
    const run = fireFn;
    fireFn = null;
    emit();
    run?.();
  };

  const scheduleTimers = () => {
    clearTimers();
    const left = Math.max(0, deadline - Date.now());
    remaining = Math.max(0, Math.ceil(left / 1000));
    emit();
    tick = setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (next !== remaining) {
        remaining = next;
        emit();
      }
    }, 250);
    timer = setTimeout(fire, left);
  };

  const unsubApp = subscribeAppState((nextState) => {
    if (nextState !== 'active' || !active) return;
    const left = deadline - Date.now();
    if (left <= 0) {
      fire();
      return;
    }
    scheduleTimers();
  });

  return {
    get active() {
      return active;
    },
    get remaining() {
      return remaining;
    },
    start(run: () => void) {
      clearTimers();
      active = true;
      fireFn = run;
      deadline = Date.now() + ms;
      scheduleTimers();
    },
    cancel() {
      active = false;
      fireFn = null;
      deadline = 0;
      clearTimers();
      emit();
    },
    flush() {
      if (active) fire();
    },
    dispose() {
      unsubApp();
      if (active) fire();
      clearTimers();
    },
  };
}

/**
 * The 10-second undo before a decision or an approval is sent (M5 §10.3, M6 §4.10/4.11).
 * Unmount flushes any pending action; going to background keeps the undo window intact.
 */
export function useUndoSend(ms = 10_000, subscribeAppState: SubscribeAppState = defaultSubscribeAppState): Undo {
  const [state, setState] = useState(() => ({
    active: false,
    remaining: Math.ceil(ms / 1000),
  }));
  const ctrlRef = useRef<UndoController | null>(null);
  if (!ctrlRef.current) {
    ctrlRef.current = createUndoController(
      ms,
      (active, remaining) => setState({ active, remaining }),
      subscribeAppState,
    );
  }

  useEffect(() => {
    const ctrl = ctrlRef.current;
    return () => {
      ctrl?.dispose();
    };
  }, []);

  const start = useCallback((run: () => void) => ctrlRef.current?.start(run), []);
  const cancel = useCallback(() => ctrlRef.current?.cancel(), []);
  const flush = useCallback(() => ctrlRef.current?.flush(), []);

  return { active: state.active, remaining: state.remaining, start, cancel, flush };
}

// --- 全局单例撤销条 Store（SS-29） ---

export interface UndoBarOptions {
  /** 写清做了什么和对象名，例如「已通过「登录页改版」」。 */
  readonly text: string;
  /** 撤销窗口毫秒数；默认 4000，通过交付用 10000。 */
  readonly ms?: number;
  /** 窗口结束且未被撤销时真正发出的动作。 */
  readonly fire: () => void;
  /** 用户点「撤销」时的可选回调。 */
  readonly onUndo?: () => void;
}

export interface UndoBarState {
  readonly active: boolean;
  readonly text: string;
  readonly remaining: number;
}

export interface UndoStore {
  getState(): UndoBarState;
  subscribe(listener: (state: UndoBarState) => void): () => void;
  show(options: UndoBarOptions): void;
  cancel(): void;
  flush(): void;
  dispose(): void;
}

const IDLE_BAR: UndoBarState = { active: false, text: '', remaining: 0 };

/**
 * 全局撤销条 store（纯逻辑，支持注入假时钟 `now` 与假 `subscribeAppState`）：
 * - 同时只有一条；调用 `show()` 时若上一条仍在倒计时，先 `fire` 上一条再展示新一条。
 * - 点 `cancel()` 撤销后不发出任何动作。
 * - 沿用 A1：切后台保留 deadline，回到前台若已超时立刻 `flush`。
 */
export function createUndoStore(
  subscribeAppState: SubscribeAppState = defaultSubscribeAppState,
  now: () => number = () => Date.now(),
): UndoStore {
  let state: UndoBarState = IDLE_BAR;
  let deadline = 0;
  let fireFn: (() => void) | null = null;
  let onUndoFn: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<(s: UndoBarState) => void>();

  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    if (tick) clearInterval(tick);
    timer = null;
    tick = null;
  };

  const emit = () => {
    for (const l of [...listeners]) l(state);
  };

  const flush = () => {
    if (!state.active) return;
    const run = fireFn;
    fireFn = null;
    onUndoFn = null;
    deadline = 0;
    clearTimers();
    state = IDLE_BAR;
    emit();
    run?.();
  };

  const scheduleTimers = () => {
    clearTimers();
    const left = Math.max(0, deadline - now());
    state = {
      ...state,
      remaining: Math.max(0, Math.ceil(left / 1000)),
    };
    emit();
    tick = setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - now()) / 1000));
      if (next !== state.remaining) {
        state = { ...state, remaining: next };
        emit();
      }
    }, 250);
    timer = setTimeout(flush, left);
  };

  const unsubApp = subscribeAppState((nextState) => {
    if (nextState !== 'active' || !state.active) return;
    if (now() >= deadline) {
      flush();
      return;
    }
    scheduleTimers();
  });

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show({ text, ms = 4000, fire, onUndo }) {
      if (state.active) {
        flush();
      }
      fireFn = fire;
      onUndoFn = onUndo ?? null;
      deadline = now() + ms;
      state = {
        active: true,
        text,
        remaining: Math.max(0, Math.ceil(ms / 1000)),
      };
      scheduleTimers();
    },
    cancel() {
      if (!state.active) return;
      const undoCb = onUndoFn;
      fireFn = null;
      onUndoFn = null;
      deadline = 0;
      clearTimers();
      state = IDLE_BAR;
      emit();
      undoCb?.();
    },
    flush,
    dispose() {
      unsubApp();
      flush();
      listeners.clear();
    },
  };
}

export const undoStore = createUndoStore();

/** 订阅全局撤销条状态，供 `UndoBar` 使用。 */
export function useUndoBar(): UndoBarState & { cancel: () => void } {
  const [state, setState] = useState<UndoBarState>(() => undoStore.getState());
  useEffect(() => {
    setState(undoStore.getState());
    return undoStore.subscribe(setState);
  }, []);
  const cancel = useCallback(() => undoStore.cancel(), []);
  return { ...state, cancel };
}
