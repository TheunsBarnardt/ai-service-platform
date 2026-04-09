import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://platform:test@localhost:5432/ai_platform_test';

let testPool: pg.Pool | null = null;

/**
 * Returns the shared test pool, creating it on first call.
 */
export function getTestPool(): pg.Pool {
  if (!testPool) {
    testPool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  }
  return testPool;
}

/**
 * Runs all migration SQL files against the test database in order.
 */
export async function setupTestDb(): Promise<void> {
  const pool = getTestPool();

  const migrationsDir = path.resolve(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
  }
}

/**
 * Drops all tables in the test database (public schema).
 */
export async function teardownTestDb(): Promise<void> {
  const pool = getTestPool();

  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );

  if (rows.length > 0) {
    const tableNames = rows.map((r) => `"${r.tablename}"`).join(', ');
    await pool.query(`DROP TABLE IF EXISTS ${tableNames} CASCADE`);
  }

  await pool.end();
  testPool = null;
}
