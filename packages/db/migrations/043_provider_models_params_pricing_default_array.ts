import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE provider_models
    ALTER COLUMN params_pricing SET DEFAULT '[]'::jsonb
  `.execute(db)

  await sql`
    UPDATE provider_models
    SET params_pricing = '[]'::jsonb
    WHERE params_pricing IS NULL
      OR params_pricing = '{}'::jsonb
  `.execute(db)

  await sql`
    UPDATE provider_models
    SET params_pricing = jsonb_build_array(params_pricing)
    WHERE jsonb_typeof(params_pricing) = 'object'
      AND params_pricing ? 'resolution'
      AND params_pricing ? 'model'
      AND params_pricing ? 'unit_price'
  `.execute(db)

  await sql`
    UPDATE provider_models pm
    SET params_pricing = fixed.rules
    FROM (
      SELECT id, jsonb_agg(value order by key::int) as rules
      FROM provider_models,
           jsonb_each(params_pricing)
      WHERE jsonb_typeof(params_pricing) = 'object'
        AND key ~ '^[0-9]+$'
      GROUP BY id
    ) fixed
    WHERE pm.id = fixed.id
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE provider_models
    ALTER COLUMN params_pricing SET DEFAULT '{}'::jsonb
  `.execute(db)
}
