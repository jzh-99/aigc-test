import type { Kysely } from 'kysely'
import { sql } from 'kysely'

const TOKENBUS_CONFIG = { api_base_url: 'https://tokenbus.wangpudata.com' }
const TOKENBUS_MODEL_MAPPINGS = [
  {
    oldCode: 'gpt-image-2',
    newCode: 'openai/gpt-image-2',
    pricing: [{ resolution: '1k', model: 'openai/gpt-image-2', unit_price: 2 }],
    schema: {
      resolution: ['1k'],
      aspect_ratio: [
        { label: '1:1', value: '1:1' },
        { label: '2:3', value: '2:3' },
        { label: '3:2', value: '3:2' },
      ],
    },
  },
  {
    oldCode: 'nano-banana-2',
    newCode: 'google/gemini-3-pro-image-preview',
    pricing: [
      { resolution: '1k', model: 'google/gemini-3-pro-image-preview', unit_price: 2 },
      { resolution: '2k', model: 'google/gemini-3-pro-image-preview', unit_price: 2 },
    ],
    schema: {
      resolution: ['1k', '2k'],
      aspect_ratio: [
        { label: '1:1', value: '1:1' },
        { label: '4:3', value: '4:3' },
        { label: '3:4', value: '3:4' },
        { label: '16:9', value: '16:9' },
        { label: '9:16', value: '9:16' },
      ],
    },
  },
  {
    oldCode: 'gemini-3.1-flash-image-preview',
    newCode: 'google/gemini-3.1-flash-image-preview',
    pricing: [
      { resolution: '1k', model: 'google/gemini-3.1-flash-image-preview', unit_price: 1 },
      { resolution: '2k', model: 'google/gemini-3.1-flash-image-preview', unit_price: 1 },
    ],
    schema: {
      resolution: ['1k', '2k'],
      aspect_ratio: [
        { label: '1:1', value: '1:1' },
        { label: '4:3', value: '4:3' },
        { label: '3:4', value: '3:4' },
        { label: '16:9', value: '16:9' },
        { label: '9:16', value: '9:16' },
      ],
    },
  },
] as const

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO providers (code, name, region, modules, is_active, config)
    VALUES (
      'tokenbus',
      '算力巴士',
      'cn',
      ${JSON.stringify(['image'])}::jsonb,
      true,
      ${JSON.stringify(TOKENBUS_CONFIG)}::jsonb
    )
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      region = EXCLUDED.region,
      modules = EXCLUDED.modules,
      is_active = EXCLUDED.is_active,
      config = EXCLUDED.config
  `.execute(db)

  for (const mapping of TOKENBUS_MODEL_MAPPINGS) {
    await sql`
      DELETE FROM provider_models
      WHERE provider_code = 'tokenbus'
        AND code = ${mapping.newCode}
        AND EXISTS (
          SELECT 1
          FROM provider_models
          WHERE code = ${mapping.oldCode}
            AND provider_code IN ('comfly', 'tokenbus')
        )
    `.execute(db)

    await sql`
      UPDATE provider_models
      SET
        provider_code = 'tokenbus',
        code = ${mapping.newCode},
        params_pricing = ${JSON.stringify(mapping.pricing)}::jsonb,
        params_schema = ${JSON.stringify(mapping.schema)}::jsonb,
        category_references = ${JSON.stringify({ text_to_image: {
          label: '文生图',
          limits: {
            image: { min: 0, max: 0 },
            video: { min: 0, max: 0 },
            audio: { min: 0, max: 0 },
            text: { min: 0, max: 0 }
          }
        } })}::jsonb,
        resolution = ${mapping.schema.resolution[0]}
      WHERE code = ${mapping.oldCode}
        AND provider_code IN ('comfly', 'tokenbus')
    `.execute(db)
  }

  await sql`
    UPDATE providers
    SET is_active = false
    WHERE code = 'comfly'
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE providers
    SET is_active = true
    WHERE code = 'comfly'
  `.execute(db)

  const reverseMappings = [
    ['openai/gpt-image-2', 'gpt-image-2'],
    ['google/gemini-3-pro-image-preview', 'nano-banana-2'],
    ['google/gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image-preview'],
  ] as const

  for (const [newCode, oldCode] of reverseMappings) {
    await sql`
      UPDATE provider_models
      SET
        provider_code = 'comfly',
        code = ${oldCode}
      WHERE code = ${newCode}
        AND provider_code = 'tokenbus'
    `.execute(db)
  }

  await sql`
    DELETE FROM providers
    WHERE code = 'tokenbus'
      AND NOT EXISTS (
        SELECT 1
        FROM provider_models
        WHERE provider_code = 'tokenbus'
      )
  `.execute(db)
}
