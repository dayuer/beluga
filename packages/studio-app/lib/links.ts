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

  // 1. /join/<inviteId>#k=&n= -> 应用内重写为 /join/<inviteId>?k=&n=，供 useLocalSearchParams 读取
  if (segments[0] === 'join' && segments.length === 2) {
    const inviteId = decodeSegment(segments[1]!);
    if (!inviteId) return null;
    const hashParams = hash ? new URLSearchParams(hash.replace(/^#/, '')) : null;
    const k = (hashParams?.get('k') ?? searchParams.get('k') ?? '').trim();
    const n = (hashParams?.get('n') ?? searchParams.get('n') ?? '').trim();
    const base = `/join/${encodeURIComponent(inviteId)}`;
    return k && n ? `${base}?k=${encodeURIComponent(k)}&n=${encodeURIComponent(n)}` : base;
  }

  // 2. /request/<id>、?card=<cardId>、?state=<演示态>
  if (segments[0] === 'request' && segments.length === 2) {
    const id = decodeSegment(segments[1]!);
    if (!id) return null;
    const card = searchParams.get('card')?.trim();
    const state = demoState(searchParams.get('state'));
    const query = [card ? `card=${encodeURIComponent(card)}` : '', state ? `state=${state}` : '']
      .filter(Boolean)
      .join('&');
    const base = `/request/${encodeURIComponent(id)}`;
    return query ? `${base}?${query}` : base;
  }

  // 2b. 根路径带演示态：/?state=empty（A10 走查用；非 demo 构建忽略这个参数）
  if (segments.length === 0) {
    const state = demoState(searchParams.get('state'));
    return state ? `/?state=${state}` : null;
  }

  // 3. /login?token= 与 /login#token=（中台邮件链接使用 #token=）
  if (segments[0] === 'login' && segments.length === 1) {
    const hashToken = hash ? new URLSearchParams(hash.replace(/^#/, '')).get('token')?.trim() : undefined;
    const token = searchParams.get('token')?.trim() || hashToken;
    if (!token) return null;
    return `/login?token=${encodeURIComponent(token)}`;
  }

  // 4. /me/devices/add
  if (segments[0] === 'me' && segments[1] === 'devices' && segments[2] === 'add' && segments.length === 3) {
    return '/me/devices/add';
  }

  return null;
}

const DEMO_STATES = new Set(['normal', 'empty', 'loading', 'offline', 'runnerOffline']);

/** 深链里只放行已知的演示态，避免把任意值塞进路由。 */
function demoState(raw: string | null | undefined): string | null {
  const state = raw?.trim();
  return state && DEMO_STATES.has(state) ? state : null;
}

function decodeSegment(seg: string): string | null {
  try {
    const decoded = decodeURIComponent(seg).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * 供 `app/+native-intent.tsx` 调用的路由分流（SS-143）：
 * 只有 `synon://`（排除 expo-development-client）与匹配 `EXPO_PUBLIC_HUB_URL` 的 `https://`
 * 才走深链解析；应用内路径（`/`、`/todo` 等）与 Dev Client 链接原样放行。
 */
export function resolveNativeIntent(path: string | null, hubUrl = process.env.EXPO_PUBLIC_HUB_URL): string | null {
  if (!path) return path;
  if (path.startsWith('/')) return path;

  let parsed: URL;
  try {
    parsed = new URL(path);
  } catch {
    return path;
  }

  if (parsed.hostname === 'expo-development-client' || parsed.pathname.includes('expo-development-client')) {
    return path;
  }

  if (parsed.protocol === 'synon:') {
    return parseDeepLink(path, hubUrl);
  }

  if (parsed.protocol === 'https:') {
    const expectedHost = getHubHost(hubUrl);
    if (expectedHost && parsed.host.toLowerCase() === expectedHost) {
      return parseDeepLink(path, hubUrl);
    }
  }

  return path;
}
