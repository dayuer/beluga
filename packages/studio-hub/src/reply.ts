/** A rule's `HubReply` as a `Response`; the one place the shell decides text vs JSON. */

import type { HubReply } from '../../../src/net/studio/handler.js';

export const jsonOf = (body: unknown, status = 200, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export const responseOf = (reply: HubReply): Response => {
  const headers = new Headers(reply.headers as Record<string, string> | undefined);
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  if (reply.status === 204 || reply.body === undefined) return new Response(null, { status: reply.status, headers });
  if (typeof reply.body === 'string') {
    if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');
    return new Response(reply.body, { status: reply.status, headers });
  }
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers });
};
