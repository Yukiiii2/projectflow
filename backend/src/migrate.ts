import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrationDatabaseUrl } from './migration-config.js';
import { runMigrations } from './migrations.js';
const pool = new pg.Pool({connectionString: loadMigrationDatabaseUrl(process.env)});
try {
  const directory = fileURLToPath(new URL('../sql/', import.meta.url));
  const result = await runMigrations(pool, directory);
  console.log(`Database schema ready (${result.applied.length} applied, ${result.skipped.length} already current)`);
}
finally {await pool.end();}
