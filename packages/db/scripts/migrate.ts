import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../../../.env') })

import type { Migration, MigrationProvider } from 'kysely'
import { Migrator } from 'kysely'
import { getDb, closeDb } from '../src/client.js'

/**
 * Custom migration provider that uses file:// URLs for dynamic import,
 * fixing Windows + non-ASCII path issues.
 */
class SafeFileMigrationProvider implements MigrationProvider {
  private folder: string
  constructor(folder: string) {
    this.folder = folder
  }
  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {}
    const files = await fs.readdir(this.folder)
    for (const file of files.sort()) {
      if (file.endsWith('.ts') || file.endsWith('.js')) {
        const filePath = path.join(this.folder, file)
        const mod = await import(pathToFileURL(filePath).href)
        const name = file.replace(/\.(ts|js)$/, '')
        migrations[name] = mod
      }
    }
    return migrations
  }
}

async function main() {
  const db = getDb()

  const migrator = new Migrator({
    db,
    provider: new SafeFileMigrationProvider(
      path.join(__dirname, '../migrations'),
    ),
  })

  const { error, results } = await migrator.migrateToLatest()

  results?.forEach((result) => {
    if (result.status === 'Success') {
      console.log(`  Migration "${result.migrationName}" applied`)
    } else if (result.status === 'Error') {
      console.error(`  Migration "${result.migrationName}" failed`)
    }
  })

  if (error) {
    console.error('Migration failed:', error)
    await closeDb()
    process.exit(1)
  }

  // Apply triggers.sql after all table migrations (idempotent: CREATE OR REPLACE)
  const triggersPath = path.join(__dirname, '../triggers.sql')
  const triggersSql = await fs.readFile(triggersPath, 'utf-8')

  // Split SQL respecting $$ dollar-quoted blocks
  const statements: string[] = []
  let current = ''
  let inDollarQuote = false
  for (const line of triggersSql.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('--')) continue
    if (trimmed.includes('$$')) {
      inDollarQuote = !inDollarQuote
    }
    current += line + '\n'
    if (!inDollarQuote && trimmed.endsWith(';')) {
      const stmt = current.trim()
      if (stmt.length > 0) statements.push(stmt)
      current = ''
    }
  }

  for (const stmt of statements) {
    await db.executeQuery({
      sql: stmt,
      parameters: [],
      query: { kind: 'RawNode' } as never,
    } as never)
  }
  console.log('  updated_at triggers applied')

  await closeDb()
  console.log('  All migrations complete')
}

main()
