import 'dotenv/config';
import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadServerConfig } from './config.js';
import { createDatabasePool } from './db.js';
import { createEmailOutbox, startEmailOutboxWorker } from './email-outbox.js';
import { disabledInvitationDelivery, invitationDeliveryFromEnv } from './invitation-delivery.js';
import { createLogger } from './logger.js';

const config = loadServerConfig(process.env);
const logger = createLogger({ level: config.logLevel });
const db = createDatabasePool(config.databaseUrl);

try {
  await db.query('SELECT 1');
} catch (error) {
  await db.end();
  throw new Error('Unable to connect to PostgreSQL', { cause: error });
}

const PgStore = connectPgSimple(session);
const transportDelivery = config.portfolioModeEnabled ? disabledInvitationDelivery() : invitationDeliveryFromEnv(config.production);
const emailOutbox = config.production && !config.portfolioModeEnabled ? createEmailOutbox(config.emailOutboxKey!) : undefined;
const app = createApp({
  db,
  sessionStore: new PgStore({ pool: db, createTableIfMissing: false }),
  invitationDelivery: transportDelivery,
  emailOutbox,
  staticAssetsPath: config.production ? fileURLToPath(new URL('../../dist/', import.meta.url)) : undefined,
  logger,
  config: {
    frontendOrigin: config.frontendOrigin,
    sessionSecret: config.sessionSecret,
    production: config.production,
    invitationTtlHours: config.invitationTtlHours,
    verificationTtlMinutes: config.verificationTtlMinutes,
    passwordResetTtlMinutes: config.passwordResetTtlMinutes,
    trustProxyHops: config.trustProxyHops,
    requireEmailVerification: config.requireEmailVerification,
    demoModeEnabled: config.demoModeEnabled,
    portfolioModeEnabled: config.portfolioModeEnabled,
  },
});

const server = app.listen(config.port, () => {
  logger.info('server_started', { port: config.port, production: config.production });
});
const emailWorker = config.production && !config.portfolioModeEnabled ? startEmailOutboxWorker(db, transportDelivery, logger, config.emailOutboxKey!) : undefined;

function shutdown(signal: string) {
  logger.info('server_shutdown', { signal });
  server.close(() => {
    void (async () => {
      await emailWorker?.stop();
      await db.end();
      process.exit(0);
    })();
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
