/**
 * The studio's view cache (docs/studio-hub.md §8, §9).
 *
 * The daemon publishes `StudioPlanView` frames; the hub parses each one again with the strict
 * schema (the envelope is not trusted), keeps the latest full snapshot per plan, merges the turns
 * by id (500 kept), and broadcasts the last 50 to the app sockets. A bad view is refused and
 * alerted, never written over a good cache. `ingestPatch` is for M3's incremental frames: it only
 * applies `rev === current + 1`, and asks for a full snapshot otherwise.
 *
 * `previewLink` is the P2 delivery gate: it can only sign once a `deliver` gate is approved; in P1
 * no such gate can exist and the route always answers 403.
 */

import { StudioPlanView, StudioTurn, type AppFrame, type StudioGate } from '../../studio/protocol.js';
import {
  PREVIEW_TTL_MS,
  TURNS_KEEP,
  TURNS_PAGE,
  VIEW_TURNS,
  b64url,
  type HubStore,
  type Project,
  type StudioStore,
} from './store.js';

/** What a view or preview needs from a handler's `Deps`; `StudioDeps` satisfies it. */
export interface ViewDeps {
  readonly hub: HubStore;
  readonly studio: StudioStore;
  readonly now: number;
}

/** Effects a view handler can produce without importing the handler (no cycle). */
export type ViewEffect =
  | { readonly to: 'app'; readonly projectId: string; readonly frame: AppFrame }
  | { readonly to: 'daemon'; readonly daemonId: string; readonly msg: { readonly t: 'resync'; readonly project: string; readonly planRef?: string } };

export type IngestResult =
  | { readonly ok: true; readonly projectId: string; readonly planRef: string; readonly effects: readonly ViewEffect[] }
  | { readonly ok: false; readonly alert: string; readonly effects: readonly ViewEffect[] };

const REF = /^[A-Za-z0-9_-]{1,64}$/;
const enc = new TextEncoder();

const resync = (daemonId: string, project: string, planRef?: string): ViewEffect => ({ to: 'daemon', daemonId, msg: { t: 'resync', project, ...(planRef ? { planRef } : {}) } });

const parseView = (json: string): StudioPlanView | undefined => {
  try {
    const parsed = StudioPlanView.safeParse(JSON.parse(json) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const parseTurn = (json: string): StudioTurn | undefined => {
  try {
    const parsed = StudioTurn.safeParse(JSON.parse(json) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const turnsOf = (rows: readonly { readonly json: string }[]): StudioTurn[] => rows.flatMap((r) => {
  const turn = parseTurn(r.json);
  return turn ? [turn] : [];
});

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The Studio project a daemon's own project id is mapped to, or undefined when it isn't ours. */
async function projectOf(deps: ViewDeps, daemonId: string, daemonProjectId: string): Promise<Project | undefined> {
  return (await deps.hub.projectsOfDaemon(daemonId)).find((p) => p.daemonProjectId === daemonProjectId);
}

/** What every app socket for this project gets: the view with the last 50 merged turns. */
async function broadcast(projectId: string, rev: number, view: StudioPlanView, deps: ViewDeps): Promise<ViewEffect> {
  const turns = turnsOf(await deps.studio.turnsBefore(projectId, view.planRef, undefined, VIEW_TURNS));
  const count = await deps.studio.turnCount(projectId, view.planRef);
  const full = StudioPlanView.parse({ ...view, turns, moreTurns: view.moreTurns || count > VIEW_TURNS });
  return { to: 'app', projectId, frame: { t: 'plan', rev, view: full } };
}

/** A full snapshot from a daemon: always replaces what was cached, whatever its rev. */
export async function ingestPlan(daemonId: string, input: { readonly project: string; readonly frame: unknown }, deps: ViewDeps): Promise<IngestResult> {
  const project = await projectOf(deps, daemonId, input.project);
  if (!project) {
    await deps.studio.alert(daemonId, 'unmapped-project', deps.now);
    return { ok: false, alert: 'unmapped-project', effects: [] };
  }

  const raw = input.frame as { readonly t?: unknown; readonly rev?: unknown; readonly view?: unknown } | null;
  if (!raw || raw.t !== 'plan' || typeof raw.rev !== 'number' || !Number.isInteger(raw.rev) || raw.rev < 0) {
    await deps.studio.alert(daemonId, 'bad-frame', deps.now);
    return { ok: false, alert: 'bad-frame', effects: [] };
  }
  // A second, explicit look at the view with the strict schema: extra fields are refused whole.
  const view = StudioPlanView.safeParse(raw.view);
  if (!view.success) {
    await deps.studio.alert(daemonId, 'bad-view', deps.now);
    return { ok: false, alert: 'bad-view', effects: [] };
  }

  await deps.studio.putView({ projectId: project.id, planRef: view.data.planRef, rev: raw.rev, viewJson: JSON.stringify(view.data), updatedAt: deps.now });
  await deps.studio.putTurns(project.id, view.data.planRef, view.data.turns, TURNS_KEEP);
  return { ok: true, projectId: project.id, planRef: view.data.planRef, effects: [await broadcast(project.id, raw.rev, view.data, deps)] };
}

/**
 * M3's incremental frame (written and tested now, not on the wire yet). `rev` must follow the
 * cached one; a gap, a bad merge or a bad set asks the daemon for a full snapshot instead.
 */
export async function ingestPatch(
  daemonId: string,
  input: { readonly project: string; readonly planRef: string; readonly rev: number; readonly set?: unknown; readonly turns?: readonly StudioTurn[] },
  deps: ViewDeps,
): Promise<IngestResult> {
  const project = await projectOf(deps, daemonId, input.project);
  if (!project) {
    await deps.studio.alert(daemonId, 'unmapped-project', deps.now);
    return { ok: false, alert: 'unmapped-project', effects: [] };
  }
  if (!REF.test(input.planRef) || !Number.isInteger(input.rev) || input.rev < 0) {
    await deps.studio.alert(daemonId, 'bad-frame', deps.now);
    return { ok: false, alert: 'bad-frame', effects: [resync(daemonId, input.project, input.planRef)] };
  }

  const row = await deps.studio.readView(project.id, input.planRef);
  const current = row ? parseView(row.viewJson) : undefined;
  if (!row || !current) {
    await deps.studio.alert(daemonId, 'unknown-plan', deps.now);
    return { ok: false, alert: 'unknown-plan', effects: [resync(daemonId, input.project, input.planRef)] };
  }
  if (input.rev !== row.rev + 1) return { ok: false, alert: 'rev-gap', effects: [resync(daemonId, input.project, input.planRef)] };
  if (input.set !== undefined && !isPlainObject(input.set)) {
    await deps.studio.alert(daemonId, 'bad-view', deps.now);
    return { ok: false, alert: 'bad-view', effects: [resync(daemonId, input.project, input.planRef)] };
  }

  // A patch may change fields, never which plan the view belongs to.
  const setPlan = isPlainObject(input.set) ? input.set.planRef : undefined;
  if (setPlan !== undefined && setPlan !== input.planRef) {
    await deps.studio.alert(daemonId, 'bad-view', deps.now);
    return { ok: false, alert: 'bad-view', effects: [resync(daemonId, input.project, input.planRef)] };
  }

  const merged = { ...current, ...(isPlainObject(input.set) ? input.set : {}), ...(input.turns ? { turns: input.turns } : {}) };
  const view = StudioPlanView.safeParse(merged);
  if (!view.success) {
    await deps.studio.alert(daemonId, 'bad-view', deps.now);
    return { ok: false, alert: 'bad-view', effects: [resync(daemonId, input.project, input.planRef)] };
  }

  await deps.studio.putView({ projectId: project.id, planRef: view.data.planRef, rev: input.rev, viewJson: JSON.stringify(view.data), updatedAt: deps.now });
  if (input.turns) await deps.studio.putTurns(project.id, view.data.planRef, view.data.turns, TURNS_KEEP);
  return { ok: true, projectId: project.id, planRef: view.data.planRef, effects: [await broadcast(project.id, input.rev, view.data, deps)] };
}

/** `plan-gone`: forget the plan's view and turns, and tell the app sockets. */
export async function ingestGone(daemonId: string, input: { readonly project: string; readonly planRef: string }, deps: ViewDeps): Promise<IngestResult> {
  const project = await projectOf(deps, daemonId, input.project);
  if (!project) {
    await deps.studio.alert(daemonId, 'unmapped-project', deps.now);
    return { ok: false, alert: 'unmapped-project', effects: [] };
  }
  if (!REF.test(input.planRef)) return { ok: false, alert: 'bad-frame', effects: [] };
  await deps.studio.deleteView(project.id, input.planRef);
  await deps.studio.deleteTurns(project.id, input.planRef);
  return { ok: true, projectId: project.id, planRef: input.planRef, effects: [{ to: 'app', projectId: project.id, frame: { t: 'plan-gone', planRef: input.planRef } }] };
}

/** One cached plan, with the newest 50 turns read from the turns table (so paging agrees). */
export async function readView(projectId: string, planRef: string, deps: ViewDeps): Promise<{ readonly view: StudioPlanView; readonly updatedAt: number } | undefined> {
  const row = await deps.studio.readView(projectId, planRef);
  if (!row) return undefined;
  const view = parseView(row.viewJson);
  if (!view) return undefined;
  const turns = turnsOf(await deps.studio.turnsBefore(projectId, planRef, undefined, VIEW_TURNS));
  const count = await deps.studio.turnCount(projectId, planRef);
  return { view: StudioPlanView.parse({ ...view, turns, moreTurns: view.moreTurns || count > VIEW_TURNS }), updatedAt: row.updatedAt };
}

/** The plan list a project page shows. A corrupt cache row is skipped, not served. */
export async function listPlans(projectId: string, deps: ViewDeps): Promise<readonly { planRef: string; title: string; stage: StudioPlanView['stage']; waitingOn: StudioPlanView['waitingOn']; headline: string; progress: StudioPlanView['progress']; updatedAt: number }[]> {
  const rows = await deps.studio.listViews(projectId);
  return rows.flatMap((row) => {
    const view = parseView(row.viewJson);
    return view ? [{ planRef: view.planRef, title: view.title, stage: view.stage, waitingOn: view.waitingOn, headline: view.headline, progress: view.progress, updatedAt: row.updatedAt }] : [];
  });
}

/** A page of turns older than `before`, ascending; `more` says whether anything is older still. */
export async function turnsBefore(projectId: string, planRef: string, before: string | undefined, limit: number, deps: ViewDeps): Promise<{ readonly turns: readonly StudioTurn[]; readonly more: boolean }> {
  const n = Number.isFinite(limit) ? Math.min(Math.max(1, Math.trunc(limit)), TURNS_PAGE) : TURNS_PAGE;
  const rows = await deps.studio.turnsBefore(projectId, planRef, before, n);
  const turns = turnsOf(rows);
  const more = rows.length > 0 ? (await deps.studio.turnsBefore(projectId, planRef, rows[0]!.turnId, 1)).length > 0 : false;
  return { turns, more };
}

export interface PreviewRequest {
  readonly objectKey: string;
  readonly origin: string;
}

export type PreviewResult = { readonly ok: true; readonly url: string; readonly exp: number } | { readonly ok: false; readonly code: 'not-delivered' };

/**
 * A preview link can only be signed for a `deliver` gate that is approved. P1's `StudioGate.kind`
 * has no `deliver`, so this always refuses here; the route is 403 too. Fails closed without a
 * secret or with a malformed object key.
 */
export async function previewLink(gate: StudioGate | undefined, req: PreviewRequest, secret: string | undefined, now: number): Promise<PreviewResult> {
  const g = gate as { readonly kind?: unknown; readonly state?: unknown } | undefined;
  if (g?.kind !== 'deliver' || g.state !== 'approved') return { ok: false, code: 'not-delivered' };
  if (!secret || !/^[A-Za-z0-9._-]{1,200}$/.test(req.objectKey)) return { ok: false, code: 'not-delivered' };
  const exp = now + PREVIEW_TTL_MS;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`${req.objectKey}:${exp}`)));
  return { ok: true, exp, url: `${req.origin.replace(/\/$/, '')}/p/${req.objectKey}?exp=${exp}&sig=${sig}` };
}
