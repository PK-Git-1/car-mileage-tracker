// Called automatically after `wrangler deploy` to apply any pending DB migrations.
// Set WORKER_URL in your environment (or .env) to your deployed worker's base URL.
// Optionally set DEPLOY_SECRET if the worker requires it.

const WORKER_URL = process.env.WORKER_URL || 'https://punch.kparthiban87.workers.dev';

const secret = process.env.DEPLOY_SECRET || '';

console.log(`post-deploy: calling ${WORKER_URL}/api/migrate ...`);

const res = await fetch(`${WORKER_URL}/api/migrate`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
  },
});

const body = await res.json();

if (!body.success) {
  console.error('post-deploy: migration failed —', body.error);
  process.exit(1);
}

const { applied = [], skipped = 0 } = body;

if (applied.length === 0) {
  console.log(`post-deploy: no pending migrations (${skipped} already applied).`);
} else {
  console.log(`post-deploy: applied ${applied.length} migration(s):`);
  for (const m of applied) {
    console.log(`  ✓ ${m.version}  ${m.description}`);
  }
}
