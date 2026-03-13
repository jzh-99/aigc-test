import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema.js'

let db: Kysely<Database> | null = null

export function getDb(): Kysely<Database> {
  if (!db) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
    })
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
