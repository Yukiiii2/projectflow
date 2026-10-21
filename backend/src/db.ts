import pg from 'pg';
import { configurePostgresTypes } from './postgres-types.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
configurePostgresTypes();
export const db = new pg.Pool({connectionString: process.env.DATABASE_URL});
