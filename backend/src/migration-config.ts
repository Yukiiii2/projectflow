function parsePostgresUrl(value: string, name: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${name} must be a valid PostgreSQL URL`) }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${name} must use PostgreSQL`)
  return url
}

export function loadMigrationDatabaseUrl(environment: NodeJS.ProcessEnv) {
  const production = environment.NODE_ENV === 'production'
  const value = environment.MIGRATION_DATABASE_URL ?? (production ? undefined : environment.DATABASE_URL)
  if (!value) throw new Error(production ? 'MIGRATION_DATABASE_URL is required in production' : 'DATABASE_URL missing')

  const url = parsePostgresUrl(value, environment.MIGRATION_DATABASE_URL ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL')
  if (production) {
    if (/-pooler(?:\.|$)/i.test(url.hostname)) {
      throw new Error('MIGRATION_DATABASE_URL must use a direct PostgreSQL endpoint because migrations use a session advisory lock')
    }
    if (!['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')) {
      throw new Error('Production MIGRATION_DATABASE_URL must include sslmode=require or stronger')
    }
  }
  return value
}
