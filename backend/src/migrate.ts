import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
try {
  const directory = fileURLToPath(new URL('../sql/', import.meta.url));
  const migrations = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const migration of migrations) await pool.query(await readFile(`${directory}${migration}`, 'utf8'));
  console.log(`Database schema installed (${migrations.length} migrations)`);
}
finally {await pool.end();}
