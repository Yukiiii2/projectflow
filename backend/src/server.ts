import 'dotenv/config';
import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import { createApp } from './app.js';
import { db } from './db.js';
import { invitationDeliveryFromEnv } from './invitation-delivery.js';

const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error('SESSION_SECRET missing');

const port = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535');
}

try {
  await db.query('SELECT 1');
} catch (error) {
  await db.end();
  throw new Error('Unable to connect to PostgreSQL', { cause: error });
}

const PgStore = connectPgSimple(session);
const app = createApp({
  db,
  sessionStore: new PgStore({ pool: db, createTableIfMissing: true }),
  invitationDelivery: invitationDeliveryFromEnv(process.env.NODE_ENV === 'production'),
  config: {
    frontendOrigin,
    sessionSecret,
    production: process.env.NODE_ENV === 'production',
    invitationTtlHours: Number(process.env.INVITATION_TTL_HOURS ?? 168),
  },
});

const server = app.listen(port, () => {
  console.log(`ProjectFlow API listening on http://localhost:${port}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received; shutting down`);
  server.close(() => {
    void db.end().finally(() => process.exit(0));
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
