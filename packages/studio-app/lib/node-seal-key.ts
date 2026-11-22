import type { SettingsView } from './views';

/**
 * 节点的 X25519 封装公钥（SS-226 交接里写明的缺口）：
 * 值要封给「执行这台项目的那台节点」，设备必须先从可信渠道拿到它的公钥。
 * 将来的来源是设置视图里的 `runner.sealKey`（由节点经中台下发）；在那之前，联调可用
 * `EXPO_PUBLIC_NODE_SEAL_KEY`（假节点的 `GET /seal-key` 给出）。拿不到时返回 `null`，界面说明还没准备好。
 */
const SEAL_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

export function resolveNodeSealKey(
  settings: Pick<SettingsView, 'runners'>,
  fromEnv: string | undefined = process.env.EXPO_PUBLIC_NODE_SEAL_KEY,
): string | null {
  for (const runner of settings.runners) {
    const key = (runner as { sealKey?: unknown }).sealKey;
    if (typeof key === 'string' && SEAL_KEY_RE.test(key)) return key;
  }
  const trimmed = fromEnv?.trim();
  return trimmed && SEAL_KEY_RE.test(trimmed) ? trimmed : null;
}
