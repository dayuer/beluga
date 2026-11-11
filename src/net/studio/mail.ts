import type { Mailer } from './handler.js';

import { LOGIN_TOKEN_TTL_MS } from './store.js';

/**
 * A real mailer for the magic link (BLG-82/114: Resend). It is wiring only: the hub's rules
 * (which emails are invited, how often) stay in `handler.ts`.
 *
 * The link is a credential. It goes in the message body and nowhere else: no log line, no subject,
 * no error text. A failed send throws a generic error; the login route turns that into a retryable
 * 503 for the customer and keeps the internal status in the server log only.
 */
export interface ResendOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
  /** The token TTL in minutes; defaults to the protocol's LOGIN_TOKEN_TTL_MS (15). */
  readonly ttlMinutes?: number;
}

const SUBJECT = '登录 Synon Studio';
const ttlOf = (options: ResendOptions): number => options.ttlMinutes ?? Math.round(LOGIN_TOKEN_TTL_MS / 60_000);
const body = (link: string, ttlMinutes: number): string =>
  `你好：\n\n用下面的链接登录 Synon Studio。链接 ${ttlMinutes} 分钟内有效，只能使用一次。\n\n${link}\n\n—— Synon Studio\n`;

export function resendMailer(options: ResendOptions): Mailer {
  const doFetch = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? 'https://api.resend.com/emails';
  return {
    async send(email: string, link: string): Promise<void> {
      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: options.from,
            to: [email],
            subject: SUBJECT,
            text: body(link, ttlOf(options)),
          }),
        });
      } catch {
        // Never put the address or the link in a log.
        console.warn('[studio] mail: resend request failed');
        throw new Error('resend-failed');
      }
      if (!res.ok) {
        console.warn(`[studio] mail: resend answered ${res.status}`);
        throw new Error('resend-failed');
      }
    },
  };
}
