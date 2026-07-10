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

const FUEL_COLUMNS = ['id', 'bunk', 'date', 'startKM', 'endKM', 'incomingKM', 'remainingKM', 'fuelAmount', 'fuelRate', 'fuelQty', 'projected', 'user_id'];
const TRIP_COLUMNS = ['id', 'Fuel_Id', 'Date', 'StartKM', 'EndKM', 'Distance', 'ToGoKM', 'Diff', 'Notes', 'user_id'];

function tableFor(sheetParam) {
  return sheetParam === 'Trips'
    ? { name: 'trips', columns: TRIP_COLUMNS }
    : { name: 'fuel_entries', columns: FUEL_COLUMNS };
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
  await pruneExpiredSessions(env.DB);
  const token = await createSession(env.DB, user.id);
  return json({ success: true, token, username: user.username });
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
  return json({ success: true, username: session.username });
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
