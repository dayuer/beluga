import { describe, expect, it } from 'vitest';
import { resendMailer } from '../../src/net/studio/mail.js';

/** BLG-82/84: Resend wiring. The link is a credential: it belongs in the message, never a log. */

describe('the Resend mailer', () => {
  it('posts a plain-text magic link to the one recipient', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mailer = resendMailer({
      apiKey: 're_test',
      from: 'Synon Studio <login@example.test>',
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response('{"id":"m1"}', { status: 200 });
      }) as typeof fetch,
    });

    await mailer.send('c1@example.test', 'https://hub.test/login#token=secret-token');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer re_test');
    const body = JSON.parse(String(calls[0]!.init?.body)) as Record<string, unknown>;
    expect(body.to).toEqual(['c1@example.test']);
    expect(body.from).toBe('Synon Studio <login@example.test>');
    expect(body.subject).toBe('登录 Synon Studio');
    expect(String(body.text)).toContain('https://hub.test/login#token=secret-token');
  });

  it('swallows a failed send without logging the address or the link', async () => {
    const logs: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void logs.push(args.join(' '));
    try {
      const mailer = resendMailer({
        apiKey: 're_test',
        from: 'login@example.test',
        fetch: (async () => new Response('nope', { status: 500 })) as typeof fetch,
      });
      await expect(mailer.send('c1@example.test', 'https://hub.test/login#token=secret-token')).resolves.toBeUndefined();
      const all = logs.join('\n');
      expect(all).toContain('500');
      expect(all).not.toContain('c1@example.test');
      expect(all).not.toContain('secret-token');
    } finally {
      console.warn = original;
    }
  });

  it('swallows a network error too', async () => {
    const mailer = resendMailer({
      apiKey: 're_test',
      from: 'login@example.test',
      fetch: (async () => {
        throw new Error('network');
      }) as typeof fetch,
    });
    await expect(mailer.send('c1@example.test', 'https://hub.test/login#token=secret-token')).resolves.toBeUndefined();
  });
});
