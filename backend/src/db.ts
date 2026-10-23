import pg from 'pg';
import { configurePostgresTypes } from './postgres-types.js';
configurePostgresTypes();

export function createDatabasePool(databaseUrl: string) {
  return new pg.Pool({ connectionString: databaseUrl });
}
