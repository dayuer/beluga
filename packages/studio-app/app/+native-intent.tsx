import { parseDeepLink } from '../lib/links';

/**
 * 原生深链入口（SS-25）：参考 companion 的做法，把系统传入的 `synon://` 与 `https://`
 * 统一交给 `lib/links.ts` 解析，坏链接返回 `null` 忽略。
 */
export function redirectSystemPath({ path }: { path: string | null; initial: boolean }): string | null {
  return parseDeepLink(path);
}
