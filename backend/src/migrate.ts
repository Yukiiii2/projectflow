import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from './migrations.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
try {
  const directory = fileURLToPath(new URL('../sql/', import.meta.url));
  const result = await runMigrations(pool, directory);
  console.log(`Database schema ready (${result.applied.length} applied, ${result.skipped.length} already current)`);
}
finally {await pool.end();}
