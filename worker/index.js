// Cloudflare Worker - primary data API (Cloudflare D1), replacing Google Apps Script
// as the frontend's live data path. Same request/response contract as AppsScript.js
// (?action=get|add|update|delete&sheet=Sheet1|Trips[&id=]) so app.js only needs its
// APPS_SCRIPT_URL constant repointed here.
//
// Google Sheets is kept in sync asynchronously (via the existing AppsScript.js
// `saveAll` action) purely as a disaster-recovery backup, never on the request path.

const FUEL_COLUMNS = ['id', 'bunk', 'date', 'startKM', 'endKM', 'incomingKM', 'remainingKM', 'fuelAmount', 'fuelRate', 'fuelQty', 'projected'];
const TRIP_COLUMNS = ['id', 'Fuel_Id', 'Date', 'StartKM', 'EndKM', 'Distance', 'ToGoKM', 'Diff', 'Notes'];

function tableFor(sheetParam) {
  return sheetParam === 'Trips'
    ? { name: 'trips', columns: TRIP_COLUMNS }
    : { name: 'fuel_entries', columns: FUEL_COLUMNS };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

async function getAllEntries(db, table) {
  const { results } = await db.prepare(`SELECT * FROM ${table.name}`).all();
  return results;
}

async function getEntry(db, table, id) {
  return await db.prepare(`SELECT * FROM ${table.name} WHERE id = ?1`).bind(id).first();
}

async function getLastFuelId(db) {
  const row = await db.prepare('SELECT id FROM fuel_entries ORDER BY rowid DESC LIMIT 1').first();
  return row ? row.id : null;
}

async function addEntry(db, table, entry) {
  entry.id = entry.id || crypto.randomUUID();
  if (table.name === 'trips' && !entry.Fuel_Id) {
    entry.Fuel_Id = await getLastFuelId(db);
  }
  const placeholders = table.columns.map((_, i) => `?${i + 1}`).join(', ');
  const values = table.columns.map(col => entry[col] ?? null);
  await db.prepare(`INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders})`)
    .bind(...values).run();
  return { success: true, entry };
}

async function updateEntry(db, table, id, updates) {
  const existing = await getEntry(db, table, id);
  if (!existing) return { success: false, error: 'Entry not found' };
  const merged = { ...existing, ...updates };
  const setClause = table.columns.filter(c => c !== 'id').map((col, i) => `${col} = ?${i + 1}`).join(', ');
  const values = table.columns.filter(c => c !== 'id').map(col => merged[col] ?? null);
  await db.prepare(`UPDATE ${table.name} SET ${setClause} WHERE id = ?${values.length + 1}`)
    .bind(...values, id).run();
  return { success: true, entry: merged };
}

async function deleteEntry(db, table, id) {
  const { meta } = await db.prepare(`DELETE FROM ${table.name} WHERE id = ?1`).bind(id).run();
  return meta.changes > 0
    ? { success: true, message: 'Entry deleted' }
    : { success: false, error: 'Entry not found' };
}

// ============ BACKUP SYNC TO GOOGLE SHEETS (async, best-effort) ============

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
    const entries = await getAllEntries(env.DB, tableFor('Sheet1'));
    const trips = await getAllEntries(env.DB, tableFor('Trips'));
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
  const action = url.searchParams.get('action');
  const sheetParam = url.searchParams.get('sheet') || 'Sheet1';
  const id = url.searchParams.get('id');
  const table = tableFor(sheetParam);
  const db = env.DB;

  try {
    if (request.method === 'GET') {
      switch (action) {
        case 'get':
          return json({ success: true, data: await getAllEntries(db, table) });
        case 'getOne': {
          const entry = await getEntry(db, table, id);
          return entry ? json({ success: true, entry }) : json({ success: false, error: 'Entry not found' });
        }
        case 'getLastFuelId':
          return json({ success: true, lastFuelId: await getLastFuelId(db) });
        case 'status':
          return json({ success: true, connected: true, message: 'Cloudflare D1 API connected' });
        default:
          return json({ success: true, data: await getAllEntries(db, table) });
      }
    }

    const payload = JSON.parse((await request.text()) || '{}');
    let result;
    switch (action) {
      case 'add':
        result = await addEntry(db, table, payload.entry || {});
        break;
      case 'update':
        result = await updateEntry(db, table, payload.id, payload.updates || {});
        break;
      case 'delete':
        result = await deleteEntry(db, table, payload.id);
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
