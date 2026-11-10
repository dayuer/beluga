/**
 * The `HubStore` over D1 (docs/studio-hub.md §4). Only SQL: which rows mean what is in
 * src/net/studio/accounts.ts, session.ts and handler.ts. Rows use snake_case; this file maps them.
 */

import {
  randomToken,
  type Customer,
  type Daemon,
  type DaemonProject,
  type HubStore,
  type Member,
  type OutboxEntry,
  type Project,
  type Session,
  type Studio,
} from '../../../src/net/studio/store.js';

interface StudioRow {
  readonly id: string;
  readonly name: string;
  readonly created_at: number;
}
interface DaemonRow {
  readonly id: string;
  readonly studio_id: string;
  readonly public_key: string;
  readonly name: string;
  readonly created_at: number;
  readonly revoked_at: number | null;
}
interface DaemonProjectRow {
  readonly daemon_id: string;
  readonly project_id: string;
  readonly name: string;
  readonly seen_at: number;
}
interface CustomerRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: 'invited' | 'active' | 'removed';
  readonly created_at: number;
}
interface ProjectRow {
  readonly id: string;
  readonly studio_id: string;
  readonly name: string;
  readonly daemon_id: string | null;
  readonly daemon_project_id: string | null;
  readonly created_at: number;
}
interface MemberRow {
  readonly project_id: string;
  readonly customer_id: string;
  readonly added_at: number;
}
interface SessionRow {
  readonly token_hash: string;
  readonly customer_id: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly revoked_at: number | null;
}
interface OutboxRow {
  readonly id: string;
  readonly customer_id: string;
  readonly link: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly email: string;
}

const studioOf = (r: StudioRow): Studio => ({ id: r.id, name: r.name, createdAt: r.created_at });
const daemonOf = (r: DaemonRow): Daemon => ({ id: r.id, studioId: r.studio_id, publicKey: r.public_key, name: r.name, createdAt: r.created_at, ...(r.revoked_at !== null ? { revokedAt: r.revoked_at } : {}) });
const projectOf = (r: ProjectRow): Project => ({ id: r.id, studioId: r.studio_id, name: r.name, ...(r.daemon_id !== null ? { daemonId: r.daemon_id } : {}), ...(r.daemon_project_id !== null ? { daemonProjectId: r.daemon_project_id } : {}), createdAt: r.created_at });
const customerOf = (r: CustomerRow): Customer => ({ id: r.id, email: r.email, name: r.name, status: r.status, createdAt: r.created_at });
const memberOf = (r: MemberRow): Member => ({ projectId: r.project_id, customerId: r.customer_id, addedAt: r.added_at });
const sessionOf = (r: SessionRow): Session => ({ tokenHash: r.token_hash, customerId: r.customer_id, createdAt: r.created_at, expiresAt: r.expires_at, ...(r.revoked_at !== null ? { revokedAt: r.revoked_at } : {}) });
const outboxOf = (r: OutboxRow): OutboxEntry & { email: string } => ({ id: r.id, customerId: r.customer_id, link: r.link, createdAt: r.created_at, expiresAt: r.expires_at, email: r.email });

export class D1HubStore implements HubStore {
  constructor(private readonly db: D1Database) {}

  private first<T>(sql: string, ...values: unknown[]): Promise<T | null> {
    return this.db.prepare(sql).bind(...values).first<T>();
  }
  private async all<T>(sql: string, ...values: unknown[]): Promise<T[]> {
    return (await this.db.prepare(sql).bind(...values).all<T>()).results;
  }
  private run(sql: string, ...values: unknown[]): Promise<number> {
    return this.db.prepare(sql).bind(...values).run().then((r) => Number(r.meta.changes ?? 0));
  }

  async createStudio(input: { readonly name: string; readonly now: number }): Promise<Studio> {
    const studio: Studio = { id: randomToken(16), name: input.name, createdAt: input.now };
    await this.run('INSERT INTO studios (id, name, created_at) VALUES (?, ?, ?)', studio.id, studio.name, studio.createdAt);
    return studio;
  }

  async listStudios(): Promise<readonly Studio[]> {
    return (await this.all<StudioRow>('SELECT id, name, created_at FROM studios ORDER BY created_at')).map(studioOf);
  }

  async studio(id: string): Promise<Studio | undefined> {
    const row = await this.first<StudioRow>('SELECT id, name, created_at FROM studios WHERE id = ?', id);
    return row ? studioOf(row) : undefined;
  }

  async issueLinkCode(input: { readonly studioId: string; readonly codeHash: string; readonly now: number; readonly ttl: number }): Promise<number | undefined> {
    if (!(await this.studio(input.studioId))) return undefined;
    const expiresAt = input.now + input.ttl;
    await this.db.batch([
      this.db.prepare('UPDATE link_codes SET expires_at = ? WHERE studio_id = ? AND used_at IS NULL AND expires_at > ?').bind(input.now, input.studioId, input.now),
      this.db.prepare('INSERT INTO link_codes (code_hash, studio_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(input.codeHash, input.studioId, input.now, expiresAt),
    ]);
    return expiresAt;
  }

  async peekLinkCode(codeHash: string, now: number): Promise<{ readonly studioId: string } | undefined> {
    const row = await this.first<{ studio_id: string }>('SELECT studio_id FROM link_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?', codeHash, now);
    return row ? { studioId: row.studio_id } : undefined;
  }

  async takeLinkCode(codeHash: string, now: number, daemonId: string): Promise<{ readonly studioId: string } | undefined> {
    const row = await this.first<{ studio_id: string }>('SELECT studio_id FROM link_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?', codeHash, now);
    if (!row) return undefined;
    const changed = await this.run('UPDATE link_codes SET used_at = ?, daemon_id = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?', now, daemonId, codeHash, now);
    return changed === 1 ? { studioId: row.studio_id } : undefined;
  }

  async daemon(id: string): Promise<Daemon | undefined> {
    const row = await this.first<DaemonRow>('SELECT * FROM daemons WHERE id = ?', id);
    return row ? daemonOf(row) : undefined;
  }

  async daemonByKey(publicKey: string): Promise<Daemon | undefined> {
    const row = await this.first<DaemonRow>('SELECT * FROM daemons WHERE public_key = ?', publicKey);
    return row ? daemonOf(row) : undefined;
  }

  async createDaemon(input: { readonly id: string; readonly studioId: string; readonly publicKey: string; readonly name: string; readonly now: number }): Promise<'ok' | 'key-taken'> {
    try {
      await this.run('INSERT INTO daemons (id, studio_id, public_key, name, created_at) VALUES (?, ?, ?, ?, ?)', input.id, input.studioId, input.publicKey, input.name, input.now);
      return 'ok';
    } catch {
      return 'key-taken';
    }
  }

  async revokeDaemon(id: string, now: number): Promise<void> {
    await this.run('UPDATE daemons SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, id);
  }

  async daemonsOfStudio(studioId: string): Promise<readonly Daemon[]> {
    return (await this.all<DaemonRow>('SELECT * FROM daemons WHERE studio_id = ? ORDER BY created_at', studioId)).map(daemonOf);
  }

  async replaceDaemonProjects(daemonId: string, projects: readonly { readonly id: string; readonly name: string }[], now: number): Promise<void> {
    const statements = [this.db.prepare('DELETE FROM daemon_projects WHERE daemon_id = ?').bind(daemonId)];
    for (const project of projects) statements.push(this.db.prepare('INSERT INTO daemon_projects (daemon_id, project_id, name, seen_at) VALUES (?, ?, ?, ?)').bind(daemonId, project.id, project.name, now));
    await this.db.batch(statements);
  }

  async daemonProjects(daemonId: string): Promise<readonly DaemonProject[]> {
    return (await this.all<DaemonProjectRow>('SELECT * FROM daemon_projects WHERE daemon_id = ? ORDER BY project_id', daemonId)).map((r) => ({ daemonId: r.daemon_id, projectId: r.project_id, name: r.name, seenAt: r.seen_at }));
  }

  async customer(id: string): Promise<Customer | undefined> {
    const row = await this.first<CustomerRow>('SELECT * FROM customers WHERE id = ?', id);
    return row ? customerOf(row) : undefined;
  }

  async customerByEmail(email: string): Promise<Customer | undefined> {
    const row = await this.first<CustomerRow>('SELECT * FROM customers WHERE email = ?', email);
    return row ? customerOf(row) : undefined;
  }

  async customers(): Promise<readonly Customer[]> {
    return (await this.all<CustomerRow>('SELECT * FROM customers ORDER BY created_at')).map(customerOf);
  }

  async createCustomer(input: { readonly id: string; readonly email: string; readonly name: string; readonly now: number }): Promise<Customer | 'email-taken'> {
    try {
      await this.run('INSERT INTO customers (id, email, name, status, created_at) VALUES (?, ?, ?, ?, ?)', input.id, input.email, input.name, 'invited', input.now);
      return { id: input.id, email: input.email, name: input.name, status: 'invited', createdAt: input.now };
    } catch {
      return 'email-taken';
    }
  }

  async removeCustomer(id: string, now: number): Promise<void> {
    await this.db.batch([
      this.db.prepare("UPDATE customers SET status = 'removed' WHERE id = ?").bind(id),
      this.db.prepare('DELETE FROM members WHERE customer_id = ?').bind(id),
      this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE customer_id = ? AND revoked_at IS NULL').bind(now, id),
      this.db.prepare('DELETE FROM login_tokens WHERE customer_id = ?').bind(id),
      this.db.prepare('DELETE FROM outbox WHERE customer_id = ?').bind(id),
    ]);
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.run('DELETE FROM customers WHERE id = ? AND status = ?', id, 'removed');
  }

  async activateCustomer(id: string): Promise<void> {
    await this.run("UPDATE customers SET status = 'active' WHERE id = ? AND status = 'invited'", id);
  }

  async project(id: string): Promise<Project | undefined> {
    const row = await this.first<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    return row ? projectOf(row) : undefined;
  }

  async projectsOfStudio(studioId: string): Promise<readonly Project[]> {
    return (await this.all<ProjectRow>('SELECT * FROM projects WHERE studio_id = ? ORDER BY created_at', studioId)).map(projectOf);
  }

  async projectsOfDaemon(daemonId: string): Promise<readonly Project[]> {
    return (await this.all<ProjectRow>('SELECT * FROM projects WHERE daemon_id = ? ORDER BY created_at', daemonId)).map(projectOf);
  }

  async projectsOfCustomer(customerId: string): Promise<readonly Project[]> {
    return (await this.all<ProjectRow>('SELECT p.* FROM projects p JOIN members m ON m.project_id = p.id WHERE m.customer_id = ? ORDER BY p.created_at', customerId)).map(projectOf);
  }

  async createProject(input: { readonly id: string; readonly studioId: string; readonly name: string; readonly now: number }): Promise<Project> {
    await this.run('INSERT INTO projects (id, studio_id, name, created_at) VALUES (?, ?, ?, ?)', input.id, input.studioId, input.name, input.now);
    return { id: input.id, studioId: input.studioId, name: input.name, createdAt: input.now };
  }

  async bindProject(input: { readonly projectId: string; readonly daemonId: string; readonly daemonProjectId: string; readonly now: number }): Promise<'ok' | 'unknown-project' | 'already-bound' | 'already-mapped'> {
    const project = await this.project(input.projectId);
    if (!project) return 'unknown-project';
    // A bound project must be unbound first (the page says so too).
    if (project.daemonId !== undefined) return 'already-bound';
    const taken = await this.first<{ id: string }>('SELECT id FROM projects WHERE daemon_id = ? AND daemon_project_id = ? AND id <> ?', input.daemonId, input.daemonProjectId, input.projectId);
    if (taken) return 'already-mapped';
    try {
      // Conditional: two operators (or two tabs) cannot both bind an unbound project to different daemons.
      const changed = await this.run('UPDATE projects SET daemon_id = ?, daemon_project_id = ? WHERE id = ? AND daemon_id IS NULL', input.daemonId, input.daemonProjectId, input.projectId);
      if (changed === 0) return 'already-bound';
    } catch {
      // The UNIQUE (daemon_id, daemon_project_id) lost a race: another project took that daemon project.
      const raced = await this.first<{ id: string }>('SELECT id FROM projects WHERE daemon_id = ? AND daemon_project_id = ? AND id <> ?', input.daemonId, input.daemonProjectId, input.projectId);
      return raced ? 'already-mapped' : 'already-bound';
    }
    return 'ok';
  }

  async unbindProject(projectId: string): Promise<void> {
    await this.run('UPDATE projects SET daemon_id = NULL, daemon_project_id = NULL WHERE id = ?', projectId);
  }

  async members(projectId: string): Promise<readonly Member[]> {
    return (await this.all<MemberRow>('SELECT * FROM members WHERE project_id = ? ORDER BY added_at', projectId)).map(memberOf);
  }

  async addMember(projectId: string, customerId: string, now: number): Promise<void> {
    await this.run('INSERT OR IGNORE INTO members (project_id, customer_id, added_at) VALUES (?, ?, ?)', projectId, customerId, now);
  }

  async removeMember(projectId: string, customerId: string): Promise<void> {
    await this.run('DELETE FROM members WHERE project_id = ? AND customer_id = ?', projectId, customerId);
  }

  async canAccess(customerId: string, projectId: string): Promise<boolean> {
    return (await this.first<{ one: number }>('SELECT 1 AS one FROM members WHERE project_id = ? AND customer_id = ?', projectId, customerId)) !== null;
  }

  async createLoginToken(input: { readonly tokenHash: string; readonly customerId: string; readonly now: number; readonly ttl: number; readonly maxPerHour: number }): Promise<boolean> {
    // One statement: the count and the insert can't interleave with another request.
    const changed = await this.run(
      `INSERT INTO login_tokens (token_hash, customer_id, created_at, expires_at)
       SELECT ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM login_tokens WHERE customer_id = ? AND created_at > ?) < ?`,
      input.tokenHash,
      input.customerId,
      input.now,
      input.now + input.ttl,
      input.customerId,
      input.now - 3_600_000,
      input.maxPerHour,
    );
    return changed === 1;
  }

  async takeLoginToken(tokenHash: string, now: number): Promise<string | undefined> {
    const row = await this.first<{ customer_id: string }>('SELECT customer_id FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', tokenHash, now);
    if (!row) return undefined;
    const changed = await this.run('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', now, tokenHash, now);
    return changed === 1 ? row.customer_id : undefined;
  }

  async createSession(input: { readonly tokenHash: string; readonly customerId: string; readonly now: number; readonly ttl: number }): Promise<void> {
    await this.run('INSERT INTO sessions (token_hash, customer_id, created_at, expires_at) VALUES (?, ?, ?, ?)', input.tokenHash, input.customerId, input.now, input.now + input.ttl);
  }

  async session(tokenHash: string): Promise<Session | undefined> {
    const row = await this.first<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', tokenHash);
    return row ? sessionOf(row) : undefined;
  }

  async touchSession(tokenHash: string, expiresAt: number): Promise<void> {
    await this.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', expiresAt, tokenHash);
  }

  async revokeSession(tokenHash: string, now: number): Promise<void> {
    await this.run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', now, tokenHash);
  }

  async revokeCustomerSessions(customerId: string, now: number): Promise<void> {
    await this.run('UPDATE sessions SET revoked_at = ? WHERE customer_id = ? AND revoked_at IS NULL', now, customerId);
  }

  async addOutbox(entry: OutboxEntry): Promise<void> {
    await this.run('INSERT INTO outbox (id, customer_id, link, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', entry.id, entry.customerId, entry.link, entry.createdAt, entry.expiresAt);
  }

  async outboxForStudio(studioId: string, now: number): Promise<readonly (OutboxEntry & { readonly email: string })[]> {
    const rows = await this.all<OutboxRow>(
      `SELECT o.*, c.email FROM outbox o
       JOIN customers c ON c.id = o.customer_id
       WHERE o.expires_at > ?
         AND o.customer_id IN (SELECT m.customer_id FROM members m JOIN projects p ON p.id = m.project_id WHERE p.studio_id = ?)
       ORDER BY o.created_at`,
      now,
      studioId,
    );
    return rows.map(outboxOf);
  }

  async dropOutbox(before: number): Promise<void> {
    await this.run('DELETE FROM outbox WHERE expires_at <= ?', before);
  }
}
