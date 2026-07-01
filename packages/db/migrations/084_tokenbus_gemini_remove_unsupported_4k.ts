import type { Kysely } from 'kysely'
import { sql } from 'kysely'

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16']

interface TokenbusGeminiModel {
  code: string
  unitPrice: number
}

const MODELS: TokenbusGeminiModel[] = [
  { code: 'google/gemini-3.1-flash-image-preview', unitPrice: 1 },
  { code: 'google/gemini-3-pro-image-preview', unitPrice: 4 },
]

function buildSchema(resolutions: string[]): Record<string, unknown> {
  return {
    resolution: resolutions,
    aspect_ratio: ASPECT_RATIOS,
    image: [],
  }
}

function buildPricing(model: TokenbusGeminiModel, resolutions: string[]): Array<Record<string, unknown>> {
  return resolutions.map((resolution) => ({
    resolution,
    model: model.code,
    unit_price: model.unitPrice,
  }))
}

export async function up(db: Kysely<any>): Promise<void> {
  for (const model of MODELS) {
    // Tokenbus Gemini generateContent 当前只透传 imageSize=1K/2K；保留 4k 会让用户误选后静默降级。
    await sql`
      UPDATE provider_models
      SET
        params_schema = ${JSON.stringify(buildSchema(['1k', '2k']))}::jsonb,
        params_pricing = ${JSON.stringify(buildPricing(model, ['1k', '2k']))}::jsonb
      WHERE provider_code = 'tokenbus' AND code = ${model.code}
    `.execute(db)
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const model of MODELS) {
    await sql`
      UPDATE provider_models
      SET
        params_schema = ${JSON.stringify(buildSchema(['1k', '2k', '4k']))}::jsonb,
        params_pricing = ${JSON.stringify(buildPricing(model, ['1k', '2k', '4k']))}::jsonb
      WHERE provider_code = 'tokenbus' AND code = ${model.code}
    `.execute(db)
  }
}
