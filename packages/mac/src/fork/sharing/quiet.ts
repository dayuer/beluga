/**
 * 批量改「我的共享」时压掉 daemon 的逐条成功 toast（BLG-218，docs/calm/sharing.md §3.2）。
 *
 * core/people.ts 的 setTrust 每次成功都会发一条 `${name}: ${level}. ${detail}`。逐人改是轻反馈
 * （行内文字变就够了），批量改最后只留一条汇总。这里不去改 IPC：只在一次改动的窗口里把
 * fork/calm/one-toast.ts 的 global 门关上，窗口外照常。失败由页面自己发 error toast，
 * 在窗口之外发，所以看得见。
 */

let depth = 0;

/** 有改动正在进行：这期间出现的 toast 不显示。 */
export const muted = (): boolean => depth > 0;

/** 在这一段里跑（顺序 await），成功 toast 不显示；异常照常抛给调用者。 */
export async function quietSuccess<T>(run: () => Promise<T>): Promise<T> {
  depth += 1;
  try {
    return await run();
  } finally {
    depth -= 1;
  }
}
