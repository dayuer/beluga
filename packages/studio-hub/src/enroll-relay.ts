/**
 * 登记帧的转发（SS-210）：中台把 `device.enroll` 帧交给在线的节点，等它回执。
 * 帧走现有的 daemon 套接字，但在 `onDaemonMessage` 之前就被截下，不改 STUDIO_PROTO：
 *
 *   中台 → 节点  {t:'enroll', reqId, inviteId, deviceId, pubkey, sealPubkey?, mac}
 *   节点 → 中台  {t:'enroll-result', reqId, ok, fingerprint?, code?}
 *
 * 中台不核对 mac（它没有 k），只搬运。节点离线或超时是「等待」，不是失败。
 */

export interface EnrollRequestFrame {
  readonly t: 'enroll';
  readonly reqId: string;
  readonly inviteId: string;
  readonly deviceId: string;
  readonly pubkey: string;
  readonly sealPubkey?: string;
  readonly mac: string;
}

export type EnrollReply =
  | { readonly status: 'ok'; readonly fingerprint: string }
  | { readonly status: 'refused'; readonly code: string }
  | { readonly status: 'offline' }
  | { readonly status: 'timeout' };

export const ENROLL_TIMEOUT_MS = 8_000;

export class EnrollRelay {
  private readonly pending = new Map<string, (reply: EnrollReply) => void>();

  /** 发出一帧并等回执；`send` 返回 false 表示没有在线的节点。 */
  request(frame: EnrollRequestFrame, send: (frame: EnrollRequestFrame) => boolean, timeoutMs = ENROLL_TIMEOUT_MS): Promise<EnrollReply> {
    return new Promise<EnrollReply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.reqId);
        resolve({ status: 'timeout' });
      }, timeoutMs);
      this.pending.set(frame.reqId, (reply) => {
        clearTimeout(timer);
        this.pending.delete(frame.reqId);
        resolve(reply);
      });
      let sent = false;
      try {
        sent = send(frame);
      } catch {
        sent = false;
      }
      if (!sent) this.pending.get(frame.reqId)?.({ status: 'offline' });
    });
  }

  /** 节点的回执；不是登记回执（或没人在等）时返回 false，交回给原来的处理。 */
  settle(raw: string): boolean {
    let frame: { t?: unknown; reqId?: unknown; ok?: unknown; fingerprint?: unknown; code?: unknown };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      return false;
    }
    if (frame.t !== 'enroll-result' || typeof frame.reqId !== 'string') return false;
    const done = this.pending.get(frame.reqId);
    if (!done) return true;
    if (frame.ok === true && typeof frame.fingerprint === 'string') done({ status: 'ok', fingerprint: frame.fingerprint });
    else done({ status: 'refused', code: typeof frame.code === 'string' ? frame.code : 'refused' });
    return true;
  }
}
