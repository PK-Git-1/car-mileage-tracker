# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Install & Run:**
```bash
npm install          # Install wrangler
npm run dev         # Start Cloudflare Worker locally (http://localhost:8787)
npm run build       # Build & copy assets to Deployment/
npm run deploy      # Deploy to Cloudflare
```

**Deployment Flow:**
1. Frontend: `index.html` + `app.js` are deployed to Cloudflare Workers (worker/index.js handles API)
2. Backup: `AppsScript.js` is deployed to Google Apps Script (async backup only, not on request path)
3. Database: Cloudflare D1 is primary; Google Sheets is kept in sync for disaster recovery

---

## Architecture Overview

```
┌──────────────────────┐
│   Mobile Browser     │
│   (index.html/app.js)│
└──────────┬───────────┘
           │ HTTP
           ↓
┌──────────────────────────────────────┐
│   Cloudflare Worker (worker/index.js)│
│   ├─ /api/data/* (CRUD)              │
│   ├─ /api/auth/* (login/register)    │
│   └─ /api/migrate (schema)           │
└──────────┬───────────────────────────┘
           │
      ┌────┴─────┐
      ↓          ↓
   ┌──────┐  ┌────────────────┐
   │ D1   │  │ Google Sheets  │
   │(Live)│  │  (Async Backup)│
   └──────┘  └────────────────┘
```

**Key Design:** Frontend talks to single endpoint (`/api/data`); Worker routes to D1 (live) or Apps Script (backup sync).

---

## Core Files & Responsibilities

### Frontend (Browser)
- **`index.html`** — HTML structure, CSS (light/dark modes), DOM scaffolding
  - Responsive mobile-first design
  - Support for "Add to Home Screen" PWA mode
  - Uses CSS variables for theming
- **`app.js`** — Frontend logic
  - Auth (login/register via `/api/auth/*`)
  - CRUD via `callAppsScript()` → `/api/data?action=get|add|update|delete`
  - localStorage for auth token persistence (so PWA stays logged in)
  - Local date normalization & timezone fixes
  - Offline support via localStorage caching

### Backend (Cloudflare Worker)
- **`worker/index.js`** — Primary API server
  - **Auth tier:** `/api/auth/register`, `/api/auth/login` → PBKDF2 hash, session tokens, DB persistence
  - **Data tier:** `/api/data?action=get|add|update|delete&sheet=Sheet1|Trips` → scoped by `user_id`
  - **Migration tier:** `/api/migrate` (POST with optional `DEPLOY_SECRET`) → auto-runs pending migrations
  - **Assets:** Static files from `./Deployment` (index.html, app.js)
  - Non-blocking migrations on fetch: runs pending migrations if schema_migrations table exists
  - Session TTL: 30 days (via `SESSION_TTL_MS` constant)

### Backup (Google Apps Script)
- **`AppsScript.js`** — Deploy to script.google.com as Web App
  - Mirrors the same `/api/data` action contract for compatibility
  - Worker calls this asynchronously to keep Google Sheets in sync
  - Used as disaster recovery, not on live request path
  - Handles Google Sheets native date/timezone edge cases (formatCellValue)

### Database (Cloudflare D1)
- **Primary tables:**
  - `fuel_entries` — odometer readings, fuel costs, calculated mileage
  - `trips` — linked to fuel_entries, category tagging, trip notes
  - `users` — username + PBKDF2 hash + salt
  - `sessions` — Bearer tokens tied to user_id
  - `schema_migrations` — version tracking for automated DDL

- **Columns of note:**
  - `fuel_entries.mileage` — calculated as `effectiveKM / fuelQty` (where effectiveKM accounts for range variance)
  - `trips.Category` — trip purpose tag (added in v20260726000000)
  - `*.user_id` — scopes all rows to the authenticated user

---

## Development Workflows

### Adding a New Feature
1. **Update schema** — add migration to `worker/index.js` MIGRATIONS array (version = YYYYMMDDHHmmss)
2. **Deploy** — `npm run deploy` triggers auto-migration on first fetch
3. **Update frontend** — add fields to `index.html` form, handle in `app.js` payload
4. **Test** — dev server with `npm run dev`

### Fixing a Bug
- Frontend bugs: edit `app.js` or `index.html`, refresh browser
- Backend bugs: edit `worker/index.js`, redeploy with `npm run deploy`
- Google Sheets sync issues: check `AppsScript.js`, redeploy via script.google.com

### Data Migrations (Schema Changes)
- **Never edit existing migrations** — always add new entries
- Version format: `YYYYMMDDHHmmss` (strictly ordered)
- Migrations auto-run on the first `/api/data` request after deploy
- See migration examples in `worker/index.js` for patterns (backfill, ALTER ADD COLUMN with duplicate handling)

### Testing Auth
- Default account created by migration: username `admin` (password hash in migration for seed data)
- New users register via `/api/auth/register` → scoped to their own rows via `user_id`
- Tokens expire after 30 days (`SESSION_TTL_MS`)

---

## Data Structures

### Fuel Entry (fuel_entries)
```js
{
  id: string,             // uid() → timestamp.base36 + random
  bunk: string,           // fuel station name
  date: string,           // YYYY-MM-DD
  startKM: number,        // odometer start
  endKM: number,          // odometer end
  incomingKM: number,     // range before fill (pre-fill)
  remainingKM: number,    // range after fill (post-trip)
  fuelAmount: number,     // money spent (₹)
  fuelRate: number,       // price per liter
  fuelQty: number,        // calculated: amount / rate
  projected: number,      // estimated range car can drive
  mileage: number,        // calculated: effectiveKM / fuelQty
  user_id: string         // scoped to owner
}
```

**Mileage Calculation:**
```
effectiveKM = (endKM - startKM) + remainingKM - incomingKM
mileage = effectiveKM / fuelQty
```

### Trip (trips)
```js
{
  id: string,             // uid()
  Fuel_Id: string,        // link to fuel_entries.id
  Date: string,           // YYYY-MM-DD
  StartKM: number,        // odometer start
  EndKM: number,          // odometer end
  Distance: number,       // calculated: EndKM - StartKM
  ToGoKM: number,         // range remaining (from fuel entry)
  Diff: number,           // delta from previous trip
  Notes: string,          // trip notes
  Mileage: number,        // snapshot of linked fuel entry's mileage
  Category: string,       // trip purpose (e.g., "work", "personal")
  user_id: string         // scoped to owner
}
```

---

## Important Constants & Configs

### wrangler.jsonc
- `compatibility_date: "2026-06-16"` — Node.js APIs available
- `d1_databases` — D1 binding named `DB` (passed as `env.DB` to handler)
- `APPS_SCRIPT_URL` — env var pointing to Google Apps Script deployment
- `DEPLOY_SECRET` — optional secret for `/api/migrate` access control
- Cron trigger: `*/30 * * * *` (every 30 min)

### worker/index.js Constants
- `PBKDF2_ITERATIONS = 100000` — password hash iterations (security)
- `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000` — token lifetime
- `USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/` — allowed usernames

### app.js Constants
- `APPS_SCRIPT_URL = '/api/data'` — relative to origin (points to Worker)
- `localStorage` keys: `authToken`, `authUsername` (persist across PWA restarts)

---

## Common Tasks

### Inspect Database
- D1 dashboard in Cloudflare UI (wrangler.jsonc has database_id)
- Or query via Worker: add a debug route to dump schema/rows

### Sync Sheets Backup
- Worker async background call to Apps Script (see worker/index.js for `saveAll` pattern)
- Or manual: `node scripts/restore-from-sheets.mjs`

### Deploy & Test Locally
```bash
npm run dev                 # Start worker on http://localhost:8787
# Edit app.js, hit refresh (changes auto-reload in dev mode)
npm run deploy              # Push to Cloudflare
# Migrations auto-run on first fetch
```

### Add/Remove Columns
1. Create migration in `worker/index.js`
2. Update FUEL_COLUMNS or TRIP_COLUMNS export
3. Deploy; migration auto-runs
4. Frontend: add/remove form fields, handle in payload

---

## Key Design Patterns

### User Scoping
All queries filter by `user_id`. E.g., in Worker:
```js
const {results} = await db.prepare(
  'SELECT * FROM fuel_entries WHERE user_id = ?1'
).bind(authUserId).all();
```

### Date Normalization
- Google Sheets native Date objects can shift timezone
- Frontend normalizes to 'YYYY-MM-DD' strings (see `normalizeDateString()` in app.js)
- D1 stores as TEXT

### Offline Support
- Frontend caches entries in localStorage
- On reconnect, syncs changes back to API
- No complex CRDT — simple last-write-wins per entry

### Migrations as Code
- Immutable version history
- Duplicate column errors ignored (safe re-runs)
- Backfill logic inline with CREATE/ALTER (see mileage migration)

---

## Testing & Validation

- **No automated tests in repo** — test manually via browser or via cURL:
  ```bash
  # Register
  curl -X POST http://localhost:8787/api/auth/register \
    -H 'Content-Type: application/json' \
    -d '{"username":"test","password":"test1234"}'
  
  # Login (get token)
  curl -X POST http://localhost:8787/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"test","password":"test1234"}'
  
  # Fetch data
  curl http://localhost:8787/api/data?action=get \
    -H 'Authorization: Bearer <token>'
  ```

---

## Troubleshooting

**"Connection error" on app:**
- Check Worker URL in wrangler.jsonc: APPS_SCRIPT_URL env var
- Dev: should be `http://localhost:8787/api/data`
- Prod: should be `https://punch.your-domain.workers.dev/api/data`

**Migrations not running:**
- Manual trigger: POST to `/api/migrate` with `DEPLOY_SECRET` header (if set)
- Or auto-runs on first `/api/data` fetch after deploy

**Google Sheets out of sync:**
- Worker async backup call may have failed; check Worker logs in Cloudflare UI
- Manual restore: `node scripts/restore-from-sheets.mjs`

**Auth token expired:**
- Frontend shows toast & clears session
- User must log in again
- Token lifetime = 30 days (SESSION_TTL_MS)
