import { z } from 'zod';
import { STAGES, WAITING_ON, StudioReceipt } from '../../../src/studio/protocol';

/**
 * The hub's list responses, parsed loosely: unknown fields are dropped, so a newer daemon or hub
 * can add fields inside protocol major 1 without breaking an installed app. The caps mirror
 * `src/studio/protocol.ts`; a response outside them is a schema error, not something to render.
 */
const ref = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().max(200);
const line = z.string().max(400);
const ms = z.number().int().min(0);

export const ProjectSummary = z.object({
  id: ref,
  studioId: ref,
  studioName: name,
  name,
});

export const ProjectsRes = z.object({
  projects: z.array(ProjectSummary).max(200),
});

export const PlanSummary = z.object({
  planRef: ref,
  title: name,
  stage: z.enum(STAGES),
  waitingOn: z.enum(WAITING_ON),
  headline: line,
  progress: z.object({ done: ms, total: ms }),
  updatedAt: ms,
});

/** Whether the studio's daemon is connected, and when it last was (M5 hub addition, §6.2). */
export const StudioStatus = z.object({
  online: z.boolean(),
  lastSyncAt: ms.nullable(),
});

export const PlansRes = z.object({
  plans: z.array(PlanSummary).max(200),
  studio: StudioStatus,
});

export const VerifyRes = z.object({
  session: z.string().min(1).max(512),
  expiresAt: ms,
  customerId: ref,
});

export const ReceiptRes = z.object({ receipt: StudioReceipt });

export type ProjectSummary = z.infer<typeof ProjectSummary>;
export type ProjectsRes = z.infer<typeof ProjectsRes>;
export type PlanSummary = z.infer<typeof PlanSummary>;
export type PlansRes = z.infer<typeof PlansRes>;
export type StudioStatus = z.infer<typeof StudioStatus>;
export type VerifyRes = z.infer<typeof VerifyRes>;

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}

/** Parse into a value or a detail a person can act on; never throws. */
export function parse<S extends z.ZodType>(
  schema: S,
  json: unknown,
): { ok: true; value: z.infer<S> } | { ok: false; detail: string } {
  const result = schema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, detail: formatIssues(result.error) };
}
