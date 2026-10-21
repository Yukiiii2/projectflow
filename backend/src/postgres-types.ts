import pg from 'pg';

export const POSTGRES_DATE_OID = 1082;

export function configurePostgresTypes() {
  // DATE represents a calendar day, not an instant. Returning the wire value
  // prevents a local UTC offset from changing YYYY-MM-DD during JSON output.
  pg.types.setTypeParser(POSTGRES_DATE_OID, (value) => value);
}
