/**
 * The operator's accounts work (docs/studio-hub.md §4, §6.1): invite a customer email, add a
 * customer to a project, map a Studio project to one of a daemon's reported projects, and read the
 * studio detail the admin page shows. Every entry here is behind the operator token (the handler
 * checks it); the customer-side refusals are elsewhere (`session.authCustomer`, `handler.appGuard`,
 * `queue.enqueue`'s membership check) — this module never grants a customer anything.
 */

import { z } from 'zod';
import type { Deps, HubReply } from './handler.js';
import { issueLoginLink, normalizeEmail } from './session.js';
import { randomToken, type Customer, type DaemonProject, type Project } from './store.js';

const reply = (status: number, body: unknown): HubReply => ({ status, body });
const failure = (status: number, error: string): HubReply => reply(status, { error });

const REF = /^[A-Za-z0-9_-]{1,64}$/;
const DAEMON_ID = /^[A-Za-z0-9_-]{32}$/;

const InviteBody = z.object({ email: z.string(), name: z.string().trim().max(200).optional() }).strict();
const ProjectBody = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const BindBody = z.object({ daemonId: z.string().regex(DAEMON_ID), daemonProjectId: z.string().regex(REF) }).strict();

/** The customers of one studio (those with a membership in one of its projects), with their projects. */
async function customersOfStudio(studioId: string, deps: Deps): Promise<Array<Customer & { readonly projectIds: readonly string[] }>> {
  const projects = await deps.hub.projectsOfStudio(studioId);
  const out = new Map<string, Customer & { projectIds: string[] }>();
  for (const project of projects) {
    for (const member of await deps.hub.members(project.id)) {
      const customer = await deps.hub.customer(member.customerId);
      if (!customer) continue;
      const seen = out.get(customer.id) ?? { ...customer, projectIds: [] };
      if (!seen.projectIds.includes(project.id)) seen.projectIds.push(project.id);
      out.set(customer.id, seen);
    }
  }
  return [...out.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** `GET /v1/admin/customers[?studio=]`: a global list, or one studio's customers. */
export async function listCustomers(studioId: string | undefined, deps: Deps): Promise<HubReply> {
  if (studioId !== undefined) {
    if (!(await deps.hub.studio(studioId))) return failure(404, 'unknown-studio');
    return reply(200, { customers: await customersOfStudio(studioId, deps) });
  }
  const customers: Array<Customer & { projectIds: string[] }> = [];
  for (const customer of await deps.hub.customers()) {
    const projectIds = (await deps.hub.projectsOfCustomer(customer.id)).map((p) => p.id);
    customers.push({ ...customer, projectIds });
  }
  return reply(200, { customers });
}

/**
 * `POST /v1/admin/customers {email, name?}`: invite. An existing invited/active row is returned
 * as is; a removed email starts a fresh account (its data was cleared when it was removed).
 */
export async function inviteCustomer(body: unknown, deps: Deps): Promise<HubReply> {
  const parsed = InviteBody.safeParse(body);
  if (!parsed.success) return failure(400, 'bad-args');
  const email = normalizeEmail(parsed.data.email);
  if (!email) return failure(400, 'bad-args');

  const existing = await deps.hub.customerByEmail(email);
  if (existing && existing.status !== 'removed') return reply(200, { customer: existing });
  if (existing) await deps.hub.deleteCustomer(existing.id);

  const created = await deps.hub.createCustomer({ id: randomToken(16, deps.random), email, name: parsed.data.name ?? '', now: deps.now });
  if (created === 'email-taken') {
    const winner = await deps.hub.customerByEmail(email);
    return winner ? reply(200, { customer: winner }) : failure(409, 'email-taken');
  }
  return reply(200, { customer: created });
}

/** `DELETE /v1/admin/customers/:cid`: tombstone, revoke sessions, clear memberships; `studioIds` is where to close sockets. */
export async function removeCustomer(cid: string, deps: Deps): Promise<HubReply> {
  const customer = await deps.hub.customer(cid);
  if (!customer) return failure(404, 'unknown-customer');
  if (customer.status === 'removed') return reply(200, { ok: true, studioIds: [] });
  const studioIds = [...new Set((await deps.hub.projectsOfCustomer(cid)).map((p) => p.studioId))];
  await deps.hub.removeCustomer(cid, deps.now);
  return reply(200, { ok: true, studioIds });
}

/** `POST /v1/admin/customers/:cid/login-link`: mail a link now and return it for a manual forward. */
export async function customerLoginLink(cid: string, deps: Deps): Promise<HubReply> {
  const customer = await deps.hub.customer(cid);
  if (!customer) return failure(404, 'unknown-customer');
  if (customer.status === 'removed') return failure(409, 'customer-removed');
  const link = await issueLoginLink(customer, deps);
  if (link === 'rate-limited') return failure(429, 'rate-limited');
  if (link === 'no-origin') return failure(503, 'hub-origin-missing');
  return reply(200, link);
}

/** `POST /v1/admin/studios/:sid/projects {name}`: a Studio project, unbound until mapped. */
export async function createProject(studioId: string, body: unknown, deps: Deps): Promise<HubReply> {
  if (!(await deps.hub.studio(studioId))) return failure(404, 'unknown-studio');
  const parsed = ProjectBody.safeParse(body);
  if (!parsed.success) return failure(400, 'bad-args');
  const count = (await deps.hub.projectsOfStudio(studioId)).length;
  if (!(await deps.ent.allows('project', studioId, count + 1))) return failure(403, 'over-limit');
  const project = await deps.hub.createProject({ id: randomToken(16, deps.random), studioId, name: parsed.data.name, now: deps.now });
  return reply(200, { project });
}

/** `PUT /v1/admin/projects/:pid/daemon {daemonId, daemonProjectId}`: one Studio project ↔ one daemon project. */
export async function bindProject(pid: string, body: unknown, deps: Deps): Promise<HubReply> {
  const project = await deps.hub.project(pid);
  if (!project) return failure(404, 'unknown-project');
  const parsed = BindBody.safeParse(body);
  if (!parsed.success) return failure(400, 'bad-args');

  const daemon = await deps.hub.daemon(parsed.data.daemonId);
  if (!daemon) return failure(404, 'unknown-daemon');
  if (daemon.revokedAt !== undefined) return failure(409, 'daemon-revoked');
  if (daemon.studioId !== project.studioId) return failure(400, 'wrong-studio');
  const reported = await deps.hub.daemonProjects(daemon.id);
  if (!reported.some((p) => p.projectId === parsed.data.daemonProjectId)) return failure(404, 'unknown-daemon-project');

  const bound = await deps.hub.bindProject({ projectId: pid, daemonId: daemon.id, daemonProjectId: parsed.data.daemonProjectId, now: deps.now });
  if (bound === 'already-bound' || bound === 'already-mapped') return failure(409, bound);
  if (bound === 'unknown-project') return failure(404, 'unknown-project');
  return reply(200, { project: await deps.hub.project(pid) });
}

/** `DELETE /v1/admin/projects/:pid/daemon`: unbind; the project and its members stay. */
export async function unbindProject(pid: string, deps: Deps): Promise<HubReply> {
  const project = await deps.hub.project(pid);
  if (!project) return failure(404, 'unknown-project');
  if (project.daemonId !== undefined) await deps.hub.unbindProject(pid);
  return reply(200, { project: await deps.hub.project(pid) });
}

/** `PUT /v1/admin/projects/:pid/members/:cid`: idempotent. */
export async function addMember(pid: string, cid: string, deps: Deps): Promise<HubReply> {
  if (!(await deps.hub.project(pid))) return failure(404, 'unknown-project');
  const customer = await deps.hub.customer(cid);
  if (!customer) return failure(404, 'unknown-customer');
  if (customer.status === 'removed') return failure(409, 'customer-removed');
  await deps.hub.addMember(pid, cid, deps.now);
  return reply(200, { ok: true });
}

/** `DELETE /v1/admin/projects/:pid/members/:cid`: access ends with the next request; the shell closes this studio's sockets. */
export async function removeMember(pid: string, cid: string, deps: Deps): Promise<HubReply> {
  const project = await deps.hub.project(pid);
  if (!project) return failure(404, 'unknown-project');
  await deps.hub.removeMember(pid, cid);
  return reply(200, { ok: true, studioId: project.studioId });
}

/** `DELETE /v1/admin/daemons/:did`: revoke the device; its connection is closed through the shell. */
export async function revokeDaemon(did: string, deps: Deps): Promise<HubReply> {
  const daemon = await deps.hub.daemon(did);
  if (!daemon) return failure(404, 'unknown-daemon');
  await deps.hub.revokeDaemon(did, deps.now);
  return reply(200, { ok: true, studioId: daemon.studioId });
}

/** `GET /v1/admin/studios/:sid`: the D1 half of the admin detail (the shell adds online/alerts from the DO). */
export async function studioDetail(sid: string, deps: Deps): Promise<HubReply> {
  const studio = await deps.hub.studio(sid);
  if (!studio) return failure(404, 'unknown-studio');
  await deps.hub.dropOutbox(deps.now);

  const daemons = await deps.hub.daemonsOfStudio(sid);
  const daemonProjects: DaemonProject[] = [];
  for (const daemon of daemons) daemonProjects.push(...(await deps.hub.daemonProjects(daemon.id)));
  const projects: Array<Project & { readonly memberIds: readonly string[] }> = [];
  for (const project of await deps.hub.projectsOfStudio(sid)) {
    projects.push({ ...project, memberIds: (await deps.hub.members(project.id)).map((m) => m.customerId) });
  }
  const outbox = await deps.hub.outboxForStudio(sid, deps.now);
  return reply(200, { studio, daemons, daemonProjects, projects, customers: await customersOfStudio(sid, deps), outbox });
}
