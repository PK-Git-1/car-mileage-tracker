-- User accounts + per-user session tokens
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Scope existing tables to their owning user
ALTER TABLE fuel_entries ADD COLUMN user_id TEXT;
ALTER TABLE trips ADD COLUMN user_id TEXT;

-- Seed an account with today's existing admin credentials (PBKDF2-SHA256,
-- 100000 iterations, matching worker/index.js) so the current login keeps
-- working unchanged, and assign all pre-existing rows to it.
INSERT INTO users (id, username, password_hash, password_salt, created_at)
VALUES (
  'legacy-admin',
  'admin',
  'd770c9bf0064acea5a87bbe6acb37021f644b4274e47e0d118f3f1021ce2178c',
  '6be3c95d87a92381d6d11e2cab095aa7',
  '2026-07-10T00:00:00.000Z'
);

UPDATE fuel_entries SET user_id = 'legacy-admin' WHERE user_id IS NULL;
UPDATE trips SET user_id = 'legacy-admin' WHERE user_id IS NULL;
