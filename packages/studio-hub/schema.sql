-- Synon Studio's D1 tables (docs/studio-hub.md §4). Apply with:
--   npx wrangler d1 execute synon-studio --local --file schema.sql
-- The studio DO's tables are created by StudioHub itself (SQLite storage).

CREATE TABLE IF NOT EXISTS studios (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS link_codes (
  code_hash  TEXT PRIMARY KEY,
  studio_id  TEXT NOT NULL REFERENCES studios(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  daemon_id  TEXT
);
CREATE INDEX IF NOT EXISTS link_codes_by_studio ON link_codes (studio_id, created_at);

CREATE TABLE IF NOT EXISTS daemons (
  id         TEXT PRIMARY KEY,
  studio_id  TEXT NOT NULL REFERENCES studios(id),
  public_key TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS daemons_by_studio ON daemons (studio_id);

CREATE TABLE IF NOT EXISTS daemon_projects (
  daemon_id  TEXT NOT NULL REFERENCES daemons(id),
  project_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  seen_at    INTEGER NOT NULL,
  PRIMARY KEY (daemon_id, project_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL CHECK (status IN ('invited', 'active', 'removed')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  studio_id         TEXT NOT NULL REFERENCES studios(id),
  name              TEXT NOT NULL,
  daemon_id         TEXT REFERENCES daemons(id),
  daemon_project_id TEXT,
  created_at        INTEGER NOT NULL,
  UNIQUE (daemon_id, daemon_project_id)
);
CREATE INDEX IF NOT EXISTS projects_by_studio ON projects (studio_id);

CREATE TABLE IF NOT EXISTS members (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (project_id, customer_id)
);
CREATE INDEX IF NOT EXISTS members_by_customer ON members (customer_id);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS login_tokens_by_customer ON login_tokens (customer_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_by_customer ON sessions (customer_id);

CREATE TABLE IF NOT EXISTS outbox (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  link        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_by_time ON outbox (expires_at);
