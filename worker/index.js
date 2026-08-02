// Cloudflare Worker - primary data API (Cloudflare D1), replacing Google Apps Script
// as the frontend's live data path. Same request/response contract as AppsScript.js
// (?action=get|add|update|delete&sheet=Sheet1|Trips[&id=]) so app.js only needs its
// APPS_SCRIPT_URL constant repointed here.
//
// Google Sheets is kept in sync asynchronously (via the existing AppsScript.js
// `saveAll` action) purely as a disaster-recovery backup, never on the request path.
//
// All /api/data requests require a Bearer session token (see /api/auth/* below) and
// are scoped to the authenticated user's own rows via user_id.

const FUEL_COLUMNS = ['id', 'bunk', 'date', 'startKM', 'endKM', 'incomingKM', 'remainingKM', 'fuelAmount', 'fuelRate', 'fuelQty', 'projected', 'mileage', 'user_id', 'vehicle_id'];
const TRIP_COLUMNS = ['id', 'Fuel_Id', 'Date', 'StartKM', 'EndKM', 'Distance', 'ToGoKM', 'Diff', 'Notes', 'Mileage', 'Category', 'user_id', 'vehicle_id', 'FuelConsumed'];
const VEHICLE_COLUMNS = ['id', 'user_id', 'name', 'model', 'plate', 'isArchived', 'created_at', 'updated_at'];

// ============ MIGRATIONS ============
// version = YYYYMMDDHHmmss — add new entries at the bottom, never edit existing ones.

const MIGRATIONS = [
  {
    version: '20260101000000',
    description: 'init_tables',
    statements: [
      `CREATE TABLE IF NOT EXISTS fuel_entries (
         id TEXT PRIMARY KEY, bunk TEXT, date TEXT, startKM REAL, endKM REAL,
         incomingKM REAL, remainingKM REAL, fuelAmount REAL, fuelRate REAL,
         fuelQty REAL, projected REAL
       )`,
      `CREATE TABLE IF NOT EXISTS trips (
         id TEXT PRIMARY KEY, Fuel_Id TEXT, Date TEXT, StartKM REAL, EndKM REAL,
         Distance REAL, ToGoKM REAL, Diff REAL, Notes TEXT
       )`,
    ],
  },
  {
    version: '20260101000001',
    description: 'users_and_ownership',
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
         id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
         password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS sessions (
         token TEXT PRIMARY KEY, user_id TEXT NOT NULL,
         created_at TEXT NOT NULL, expires_at TEXT NOT NULL
       )`,
      `ALTER TABLE fuel_entries ADD COLUMN user_id TEXT`,
      `ALTER TABLE trips ADD COLUMN user_id TEXT`,
      `INSERT OR IGNORE INTO users (id, username, password_hash, password_salt, created_at)
       VALUES ('legacy-admin','admin',
         'd770c9bf0064acea5a87bbe6acb37021f644b4274e47e0d118f3f1021ce2178c',
         '6be3c95d87a92381d6d11e2cab095aa7','2026-07-10T00:00:00.000Z')`,
      `UPDATE fuel_entries SET user_id = 'legacy-admin' WHERE user_id IS NULL`,
      `UPDATE trips       SET user_id = 'legacy-admin' WHERE user_id IS NULL`,
    ],
  },
  {
    version: '20260720000000',
    description: 'add_mileage_columns',
    statements: [
      `ALTER TABLE fuel_entries ADD COLUMN mileage REAL`,
      `ALTER TABLE trips        ADD COLUMN Mileage REAL`,
    ],
  },
  {
    version: '20260720000001',
    description: 'backfill_mileage',
    statements: [
      // Fuel entries: effectiveKM = (endKM - startKM) + remainingKM - incomingKM
      `UPDATE fuel_entries
       SET mileage = ROUND(
         ((endKM - startKM) + COALESCE(remainingKM, 0) - COALESCE(incomingKM, 0)) / fuelQty, 2
       )
       WHERE fuelQty IS NOT NULL AND fuelQty > 0
         AND endKM IS NOT NULL AND startKM IS NOT NULL
         AND mileage IS NULL`,
      // Trips: snapshot the mileage from the linked fuel entry
      `UPDATE trips
       SET Mileage = (
         SELECT ROUND(
           ((fe.endKM - fe.startKM) + COALESCE(fe.remainingKM, 0) - COALESCE(fe.incomingKM, 0)) / fe.fuelQty, 2
         )
         FROM fuel_entries fe
         WHERE fe.id = trips.Fuel_Id
           AND fe.fuelQty IS NOT NULL AND fe.fuelQty > 0
           AND fe.endKM IS NOT NULL AND fe.startKM IS NOT NULL
       )
       WHERE trips.Fuel_Id IS NOT NULL AND trips.Mileage IS NULL`,
    ],
  },
  {
    version: '20260726000000',
    description: 'add_trip_category',
    statements: [
      `ALTER TABLE trips ADD COLUMN Category TEXT`,
    ],
  },
  {
    version: '20260802000000',
    description: 'add_vehicles_table',
    statements: [
      `CREATE TABLE IF NOT EXISTS vehicles (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         name TEXT NOT NULL,
         model TEXT,
         plate TEXT,
         isArchived INTEGER DEFAULT 0,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY(user_id) REFERENCES users(id)
       )`,
      `ALTER TABLE fuel_entries ADD COLUMN vehicle_id TEXT`,
      `ALTER TABLE trips ADD COLUMN vehicle_id TEXT`,
    ],
  },
  {
    version: '20260802000001',
    description: 'add_lastVehicleId_to_users',
    statements: [
      `ALTER TABLE users ADD COLUMN lastVehicleId TEXT`,
    ],
  },
  {
    version: '20260802000002',
    description: 'add_fuel_consumed_to_trips',
    statements: [
      `ALTER TABLE trips ADD COLUMN FuelConsumed REAL`,
    ],
  },
];

async function runMigrations(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      description TEXT,
      applied_at  TEXT NOT NULL
    )
  `).run();

  const { results } = await db.prepare('SELECT version FROM schema_migrations').all();
  const applied = new Set(results.map(r => r.version));
  const pending = MIGRATIONS.filter(m => !applied.has(m.version));

  const log = [];
  for (const migration of pending) {
    for (const sql of migration.statements) {
      try {
        await db.prepare(sql).run();
      } catch (err) {
        // Ignore "duplicate column name" — ALTER TABLE ADD COLUMN on an existing column
        if (err.message && err.message.includes('duplicate column name')) continue;
        throw new Error(`Migration ${migration.version} failed: ${err.message} | SQL: ${sql.slice(0, 80)}`);
      }
    }
    await db.prepare(
      'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?1, ?2, ?3)'
    ).bind(migration.version, migration.description, new Date().toISOString()).run();
    log.push({ version: migration.version, description: migration.description });
  }

  return { applied: log, skipped: applied.size };
}

async function handleMigrate(request, env) {
  if (request.method !== 'POST') return json({ success: false, error: 'POST required' }, 405);
  const secret = env.DEPLOY_SECRET;
  if (secret) {
    const provided = getBearerToken(request);
    if (provided !== secret) return json({ success: false, error: 'Unauthorized' }, 401);
  }
  try {
    const result = await runMigrations(env.DB);
    return json({ success: true, ...result });
  } catch (err) {
    return json({ success: false, error: err.message }, 500);
  }
}

function tableFor(sheetParam) {
  if (sheetParam === 'Trips') return { name: 'trips', columns: TRIP_COLUMNS };
  if (sheetParam === 'Vehicles') return { name: 'vehicles', columns: VEHICLE_COLUMNS };
  return { name: 'fuel_entries', columns: FUEL_COLUMNS };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

// ============ AUTH ============

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH_BITS = 256;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bufToHex(bytes);
}

async function hashPassword(password, saltHex) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBuf(saltHex), iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    PBKDF2_KEY_LENGTH_BITS
  );
  return bufToHex(derived);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function findUserByUsername(db, username) {
  return await db.prepare('SELECT * FROM users WHERE username = ?1').bind(username).first();
}

async function createUser(db, username, password) {
  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  await db.prepare('INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(id, username, hash, salt, new Date().toISOString()).run();
  return { id, username };
}

async function createSession(db, userId) {
  const token = randomHex(32);
  const now = Date.now();
  await db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(token, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString()).run();
  return token;
}

async function pruneExpiredSessions(db) {
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(new Date().toISOString()).run();
}

async function getSessionUser(db, token) {
  if (!token) return null;
  const row = await db.prepare(
    `SELECT users.id AS id, users.username AS username, sessions.expires_at AS expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ?1`
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { userId: row.id, username: row.username };
}

async function requireAuth(request, db) {
  return await getSessionUser(db, getBearerToken(request));
}

async function readJson(request) {
  try {
    return JSON.parse((await request.text()) || '{}');
  } catch {
    return null;
  }
}

async function handleRegister(request, env) {
  const payload = await readJson(request);
  if (!payload) return json({ success: false, error: 'Invalid request body' }, 400);

  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');

  if (!USERNAME_RE.test(username)) {
    return json({ success: false, error: 'Username must be 3-32 characters (letters, numbers, . _ -)' }, 400);
  }
  if (password.length < 8) {
    return json({ success: false, error: 'Password must be at least 8 characters' }, 400);
  }
  if (await findUserByUsername(env.DB, username)) {
    return json({ success: false, error: 'Username already taken' }, 409);
  }

  const user = await createUser(env.DB, username, password);
  return json({ success: true, username: user.username });
}

async function handleLogin(request, env) {
  const payload = await readJson(request);
  if (!payload) return json({ success: false, error: 'Invalid request body' }, 400);

  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');

  const user = await findUserByUsername(env.DB, username);
  if (!user) return json({ success: false, error: 'Invalid username or password' }, 401);

  const hash = await hashPassword(password, user.password_salt);
  if (!timingSafeEqual(hash, user.password_hash)) {
    return json({ success: false, error: 'Invalid username or password' }, 401);
  }

  await pruneExpiredSessions(env.DB);
  const token = await createSession(env.DB, user.id);
  return json({ success: true, token, username: user.username });
}

async function handleLogout(request, env) {
  const token = getBearerToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
  return json({ success: true });
}

async function handleMe(request, env) {
  const session = await requireAuth(request, env.DB);
  if (!session) return json({ success: false, error: 'Unauthorized' }, 401);

  const user = await env.DB.prepare('SELECT id, username, lastVehicleId FROM users WHERE id = ?1').bind(session.userId).first();
  return json({ success: true, username: session.username, lastVehicleId: user?.lastVehicleId });
}

async function handleSetCurrentVehicle(request, env) {
  const session = await requireAuth(request, env.DB);
  if (!session) return json({ success: false, error: 'Unauthorized' }, 401);

  const payload = await readJson(request);
  if (!payload || !payload.vehicleId) return json({ success: false, error: 'vehicleId required' }, 400);

  const vehicleId = payload.vehicleId;
  const userId = session.userId;

  // Verify vehicle exists and belongs to user
  const vehicle = await env.DB.prepare('SELECT id FROM vehicles WHERE id = ?1 AND user_id = ?2').bind(vehicleId, userId).first();
  if (!vehicle) return json({ success: false, error: 'Vehicle not found or access denied' }, 404);

  // Update user's lastVehicleId
  await env.DB.prepare('UPDATE users SET lastVehicleId = ?1 WHERE id = ?2').bind(vehicleId, userId).run();

  return json({ success: true, lastVehicleId: vehicleId });
}

// ============ ENTRY CRUD (scoped to the authenticated user) ============

async function getAllEntries(db, table, userId) {
  const { results } = await db.prepare(`SELECT * FROM ${table.name} WHERE user_id = ?1`).bind(userId).all();
  return results;
}

async function getEntry(db, table, id, userId) {
  return await db.prepare(`SELECT * FROM ${table.name} WHERE id = ?1 AND user_id = ?2`).bind(id, userId).first();
}

async function getLastFuelId(db, userId) {
  const row = await db.prepare('SELECT id FROM fuel_entries WHERE user_id = ?1 ORDER BY rowid DESC LIMIT 1').bind(userId).first();
  return row ? row.id : null;
}

async function addEntry(db, table, entry, userId) {
  entry.id = entry.id || crypto.randomUUID();
  entry.user_id = userId;
  if (table.name === 'trips' && !entry.Fuel_Id) {
    entry.Fuel_Id = await getLastFuelId(db, userId);
  }
  const placeholders = table.columns.map((_, i) => `?${i + 1}`).join(', ');
  const values = table.columns.map(col => entry[col] ?? null);
  await db.prepare(`INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders})`)
    .bind(...values).run();
  return { success: true, entry };
}

async function updateEntry(db, table, id, updates, userId) {
  const existing = await getEntry(db, table, id, userId);
  if (!existing) return { success: false, error: 'Entry not found' };
  const merged = { ...existing, ...updates, user_id: userId };
  const setClause = table.columns.filter(c => c !== 'id').map((col, i) => `${col} = ?${i + 1}`).join(', ');
  const values = table.columns.filter(c => c !== 'id').map(col => merged[col] ?? null);
  await db.prepare(`UPDATE ${table.name} SET ${setClause} WHERE id = ?${values.length + 1} AND user_id = ?${values.length + 2}`)
    .bind(...values, id, userId).run();
  return { success: true, entry: merged };
}

async function deleteEntry(db, table, id, userId) {
  const { meta } = await db.prepare(`DELETE FROM ${table.name} WHERE id = ?1 AND user_id = ?2`).bind(id, userId).run();
  return meta.changes > 0
    ? { success: true, message: 'Entry deleted' }
    : { success: false, error: 'Entry not found' };
}

// ============ BACKUP SYNC TO GOOGLE SHEETS (async, best-effort, all users) ============

async function getAllEntriesForBackup(db, table) {
  const { results } = await db.prepare(`SELECT * FROM ${table.name}`).all();
  return results;
}

async function pushSaveAll(env, dataArray, sheetName) {
  const url = new URL(env.APPS_SCRIPT_URL);
  url.searchParams.set('action', 'saveAll');
  url.searchParams.set('sheet', sheetName);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ data: dataArray }),
  });
  if (!res.ok) throw new Error(`saveAll ${sheetName} failed: HTTP ${res.status}`);
  const result = await res.json();
  if (!result.success) throw new Error(result.error || `saveAll ${sheetName} failed`);
}

async function syncToSheets(env) {
  if (!env.APPS_SCRIPT_URL) {
    // Local dev (.dev.vars) deliberately leaves this unset so no local testing
    // can ever reach the real production Sheet. This is expected there, not an error.
    console.log('Backup sync skipped: APPS_SCRIPT_URL not configured (expected in local dev).');
    return;
  }
  try {
    const entries = await getAllEntriesForBackup(env.DB, tableFor('Sheet1'));
    const trips = await getAllEntriesForBackup(env.DB, tableFor('Trips'));
    await pushSaveAll(env, entries, 'Sheet1');
    await pushSaveAll(env, trips, 'Trips');
    console.log(`Backup sync OK: ${entries.length} entries, ${trips.length} trips`);
  } catch (err) {
    // Best-effort: a failed backup sync must never surface to the user.
    // The cron trigger retries this on its own schedule regardless.
    console.error('Backup sync to Sheets failed:', err.message);
  }
}

// ============ REQUEST HANDLING ============

async function handleData(request, env, ctx, url) {
  const session = await requireAuth(request, env.DB);
  if (!session) return json({ success: false, error: 'Unauthorized' }, 401);
  const userId = session.userId;

  const action = url.searchParams.get('action');
  const sheetParam = url.searchParams.get('sheet') || 'Sheet1';
  const id = url.searchParams.get('id');
  const table = tableFor(sheetParam);
  const db = env.DB;

  try {
    if (request.method === 'GET') {
      switch (action) {
        case 'get':
          return json({ success: true, data: await getAllEntries(db, table, userId) });
        case 'getOne': {
          const entry = await getEntry(db, table, id, userId);
          return entry ? json({ success: true, entry }) : json({ success: false, error: 'Entry not found' });
        }
        case 'getLastFuelId':
          return json({ success: true, lastFuelId: await getLastFuelId(db, userId) });
        case 'status':
          return json({ success: true, connected: true, message: 'Cloudflare D1 API connected' });
        default:
          return json({ success: true, data: await getAllEntries(db, table, userId) });
      }
    }

    const payload = JSON.parse((await request.text()) || '{}');
    let result;
    switch (action) {
      case 'add':
        result = await addEntry(db, table, payload.entry || {}, userId);
        break;
      case 'update':
        result = await updateEntry(db, table, payload.id, payload.updates || {}, userId);
        break;
      case 'delete':
        result = await deleteEntry(db, table, payload.id, userId);
        break;
      default:
        return json({ success: false, error: 'Unknown action' });
    }

    if (result.success && (action === 'add' || action === 'update' || action === 'delete')) {
      ctx.waitUntil(syncToSheets(env));
    }
    return json(result);
  } catch (err) {
    return json({ success: false, error: err.message }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      await runMigrations(env.DB);
    } catch (err) {
      console.error('Auto-migration failed (non-blocking):', err.message);
    }

    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      return handleRegister(request, env);
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      return handleMe(request, env);
    }
    if (url.pathname === '/api/auth/setCurrentVehicle' && request.method === 'POST') {
      return handleSetCurrentVehicle(request, env);
    }

    if (url.pathname === '/api/migrate') {
      return handleMigrate(request, env);
    }

    if (url.pathname === '/api/data') {
      return handleData(request, env, ctx, url);
    }

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      ctx.waitUntil(syncToSheets(env));
      return json({ success: true, message: 'Sync started' });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncToSheets(env));
  },
};
