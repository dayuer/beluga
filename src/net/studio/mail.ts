import type { Mailer } from './handler.js';

/**
 * A real mailer for the magic link (BLG-82: Resend). It is wiring only: the hub's rules (which
 * emails are invited, how often) stay in `handler.ts`.
 *
 * The link is a credential. It goes in the message body and nowhere else: no log line, no subject,
 * no error text. A failed send is swallowed (the login route always answers 202 either way) and
 * logged as a status only.
 */
export interface ResendOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
}

const SUBJECT = '登录 Synon Studio';
const body = (link: string): string =>
  `用下面的链接登录 Synon Studio。链接 15 分钟内有效，只能使用一次。\n\n${link}\n\n` +
  `Sign in to Synon Studio. This link is valid for 15 minutes and can be used once.\n`;

export function resendMailer(options: ResendOptions): Mailer {
  const doFetch = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? 'https://api.resend.com/emails';
  return {
    async send(email: string, link: string): Promise<void> {
      try {
        const res = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: options.from,
            to: [email],
            subject: SUBJECT,
            text: body(link),
          }),
        });
        if (!res.ok) console.warn(`[studio] mail: resend answered ${res.status}`);
      } catch {
        // Never put the address or the link in a log.
        console.warn('[studio] mail: resend request failed');
      }
    },
  };
}
