import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_models pm
    SET is_active = false
    FROM providers p
    WHERE p.id = pm.provider_id
      AND p.code = 'ctyun-edge'
      AND pm.code = 'ctyun-seedream-5.0-lite'
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_models pm
    SET is_active = true
    FROM providers p
    WHERE p.id = pm.provider_id
      AND p.code = 'ctyun-edge'
      AND pm.code = 'ctyun-seedream-5.0-lite'
  `.execute(db)
}
