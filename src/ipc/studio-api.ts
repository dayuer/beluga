import { z } from 'zod';

/**
 * Synon Studio, the customer's view of your plans (see api.ts): link this Mac to a studio with the
 * admin page's binding code, share a project with it, read the link's state, reconnect, unlink.
 * Only the Mac does these; the phone and external agents never publish a plan to customers.
 * Browser-safe: zod only.
 */

const code = z.string().trim().min(1).max(20);
const hub = z.string().trim().min(1).max(300);
const name = z.string().trim().min(1).max(80);
const projectId = z.string().min(1).max(200);

export const STUDIO_API = {
  // → { ok: true, status } or { ok: false, error } ("bad-code", "bad-hub", "unreachable", "already-linked").
  'studio.link': { args: z.tuple([code, hub.optional(), name.optional()]) },
  'studio.unlink': { args: z.tuple([]) },
  'studio.status': { args: z.tuple([]) },
  'studio.setProject': { args: z.tuple([projectId, z.boolean()]) },
  'studio.reconnect': { args: z.tuple([]) },
} as const;
