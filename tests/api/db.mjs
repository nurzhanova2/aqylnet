// Direct Postgres access used only to assert invariants that have no HTTP
// surface: the BUG-4 lock invariant (no stale advisory lock left behind) and,
// since stage E4, the LlmUsage accounting rows — spend is deliberately not
// exposed through the API. Test-only diagnostics, not a production dependency.
// Every other test in this suite stays black-box (HTTP only).
import pg from 'pg';

// No default. The one that used to be here (postgres:postgres@localhost)
// reached the same docker Postgres and failed with 28P01 "password
// authentication failed", so a variable missing from the test process looked
// like a wrong password. Checked on first use, not at import, so the HTTP-only
// tests in the same files still run and report on their own.
function connectionString() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set in the environment of the test process. ' +
      "PowerShell: $env:TEST_DATABASE_URL = 'postgresql://postgres:<password>@127.0.0.1:5432/aqylnet?schema=public'; " +
      "bash: export TEST_DATABASE_URL='…' (without export node --test does not inherit it). " +
      'It lives only in the current terminal window. See .env.test.example.',
    );
  }
  return url;
}

/**
 * True if a granted advisory lock currently exists for the given bigint key
 * (matches the single-argument pg_try_advisory_xact_lock(key) form used by
 * iterationService.runIteration — projectId is the key).
 */
export async function hasGrantedAdvisoryLock(key) {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT 1 FROM pg_locks
       WHERE locktype = 'advisory' AND granted = true
         AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
      [key],
    );
    return res.rowCount > 0;
  } finally {
    await client.end();
  }
}

/**
 * Runs a read-only query and returns its rows.
 *
 * Used for assertions about rows the API intentionally does not expose. Opens
 * and closes its own connection per call: these tests run a handful of queries
 * and a shared pool would be one more thing to tear down correctly.
 */
export async function query(sql, params = []) {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    await client.end();
  }
}
