import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_models pm
    SET name = CASE pm.code
      WHEN 'ctyun-seedream-5.0-lite' THEN 'Cdream 5.0 Lite'
      WHEN 'ctyun-seedance-2.0' THEN 'Cdance 2.0'
      WHEN 'ctyun-seedance-2.0-fast' THEN 'Cdance 2.0 Fast'
      ELSE pm.name
    END
    FROM providers p
    WHERE p.id = pm.provider_id
      AND p.code = 'ctyun-edge'
      AND pm.code IN (
        'ctyun-seedream-5.0-lite',
        'ctyun-seedance-2.0',
        'ctyun-seedance-2.0-fast'
      )
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_models pm
    SET name = CASE pm.code
      WHEN 'ctyun-seedream-5.0-lite' THEN '天翼云 Seedream 5.0 Lite'
      WHEN 'ctyun-seedance-2.0' THEN '天翼云 Seedance 2.0'
      WHEN 'ctyun-seedance-2.0-fast' THEN '天翼云 Seedance 2.0 Fast'
      ELSE pm.name
    END
    FROM providers p
    WHERE p.id = pm.provider_id
      AND p.code = 'ctyun-edge'
      AND pm.code IN (
        'ctyun-seedream-5.0-lite',
        'ctyun-seedance-2.0',
        'ctyun-seedance-2.0-fast'
      )
  `.execute(db)
}
