import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { configurePostgresTypes, POSTGRES_DATE_OID } from './postgres-types.js';

describe('PostgreSQL date-only parsing', () => {
  const originalParser = pg.types.getTypeParser(POSTGRES_DATE_OID, 'text');

  afterEach(() => {
    pg.types.setTypeParser(POSTGRES_DATE_OID, originalParser);
  });

  it('keeps DATE values as YYYY-MM-DD strings in every process timezone', () => {
    configurePostgresTypes();
    const parser = pg.types.getTypeParser(POSTGRES_DATE_OID, 'text');

    expect(parser('2026-10-27')).toBe('2026-10-27');
    expect(parser('2026-01-01')).toBe('2026-01-01');
    expect(parser('2026-12-31')).toBe('2026-12-31');
  });
});
