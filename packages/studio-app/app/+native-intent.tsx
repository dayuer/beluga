import { resolveNativeIntent } from '../lib/links';

/**
 * 原生深链入口（SS-25 / SS-143）：参考 companion 的做法，只有 `synon://` 与匹配中台
 * 主机的 `https://` 链接才走深链重写；应用内路径与 Dev Client 链接原样放行。
 */
export function redirectSystemPath({ path }: { path: string | null; initial: boolean }): string | null {
  return resolveNativeIntent(path);
}
