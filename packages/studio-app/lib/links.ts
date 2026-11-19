/**
 * 深链路由表（SS-25）：把 `synon://` 与 `https://<hub>/` 解析成应用内路由。
 * 之后的任务只实现目标屏，不再修改这里的路由表。
 */

const KNOWN_SCHEMES = new Set(['synon:', 'https:']);

/** 从 `EXPO_PUBLIC_HUB_URL` 提取中台主机名（不含端口时为 hostname，含端口时保留 host）。 */
export function getHubHost(hubUrl = process.env.EXPO_PUBLIC_HUB_URL): string | null {
  if (!hubUrl) return null;
  try {
    const parsed = new URL(hubUrl.trim());
    return parsed.hostname ? parsed.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * 将外部深链（`synon://...` 或 `https://<hub>/...`）或应用内路径解析成规范化的应用内路由。
 * 无法识别或域名不匹配时返回 `null`。
 */
export function parseDeepLink(raw: string | null | undefined, hubUrl = process.env.EXPO_PUBLIC_HUB_URL): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let pathname: string;
  let searchParams: URLSearchParams;
  let hash: string;

  if (trimmed.startsWith('/')) {
    try {
      const parsed = new URL(trimmed, 'https://local.invalid');
      pathname = parsed.pathname;
      searchParams = parsed.searchParams;
      hash = parsed.hash;
    } catch {
      return null;
    }
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }

    if (!KNOWN_SCHEMES.has(parsed.protocol)) return null;

    if (parsed.protocol === 'https:') {
      const expectedHost = getHubHost(hubUrl);
      if (!expectedHost || parsed.host.toLowerCase() !== expectedHost) return null;
      pathname = parsed.pathname;
    } else {
      // `synon://join/123` 中 URL 把 `join` 当作 host；`synon:///join/123` 中 host 为空。
      pathname = parsed.host ? `/${parsed.host}${parsed.pathname}` : parsed.pathname;
    }

    searchParams = parsed.searchParams;
    hash = parsed.hash;
  }

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // 1. /join/<inviteId>#k=&n=
  if (segments[0] === 'join' && segments.length === 2) {
    const inviteId = decodeSegment(segments[1]!);
    if (!inviteId) return null;
    return `/join/${encodeURIComponent(inviteId)}${hash}`;
  }

  // 2. /request/<id> 与 /request/<id>?card=<cardId>
  if (segments[0] === 'request' && segments.length === 2) {
    const id = decodeSegment(segments[1]!);
    if (!id) return null;
    const card = searchParams.get('card')?.trim();
    const base = `/request/${encodeURIComponent(id)}`;
    return card ? `${base}?card=${encodeURIComponent(card)}` : base;
  }

  // 3. /login?token=
  if (segments[0] === 'login' && segments.length === 1) {
    const token = searchParams.get('token')?.trim();
    if (!token) return null;
    return `/login?token=${encodeURIComponent(token)}`;
  }

  // 4. /me/devices/add
  if (segments[0] === 'me' && segments[1] === 'devices' && segments[2] === 'add' && segments.length === 3) {
    return '/me/devices/add';
  }

  return null;
}

function decodeSegment(seg: string): string | null {
  try {
    const decoded = decodeURIComponent(seg).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}
