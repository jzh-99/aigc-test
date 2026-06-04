import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema.js'

let db: Kysely<Database> | null = null

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function buildPgPoolConfig(env: NodeJS.ProcessEnv = process.env): pg.PoolConfig {
  return {
    connectionString: env.DATABASE_URL,
    max: readPositiveInteger(env.PG_POOL_MAX),
    idleTimeoutMillis: readPositiveInteger(env.PG_IDLE_TIMEOUT_MS),
    connectionTimeoutMillis: readPositiveInteger(env.PG_CONNECTION_TIMEOUT_MS),
  }
}

export function getDb(): Kysely<Database> {
  if (!db) {
    const pool = new pg.Pool(buildPgPoolConfig())
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
    })
  }
  return db
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy()
    db = null
  }
}
