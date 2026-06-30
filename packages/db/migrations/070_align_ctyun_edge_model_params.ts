import { type Kysely, sql } from 'kysely'

const SEEDREAM_IMAGE_CATEGORY_REFERENCES = {
  text_to_image: {
    label: '文生图',
    limits: {
      image: { min: 0, max: 0 },
      video: { min: 0, max: 0 },
      audio: { min: 0, max: 0 },
      text: { min: 0, max: 0 },
    },
  },
  image_to_image: {
    label: '图生图',
    limits: {
      image: { min: 0, max: 10 },
      video: { min: 0, max: 0 },
      audio: { min: 0, max: 0 },
      text: { min: 0, max: 0 },
    },
  },
}

const SEEDREAM_5_IMAGE_SCHEMA = {
  resolution: ['2k', '3k', '4k'],
  aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
  image: [],
}

const CTYUN_SEEDREAM_5_PRICING = [
  { resolution: '2k', model: 'ctyun-seedream-5.0-lite', unit_price: 4 },
  { resolution: '3k', model: 'ctyun-seedream-5.0-lite', unit_price: 4 },
  { resolution: '4k', model: 'ctyun-seedream-5.0-lite', unit_price: 4 },
]

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_models pm
    SET
      category_references = ${JSON.stringify(SEEDREAM_IMAGE_CATEGORY_REFERENCES)},
      params_schema = ${JSON.stringify(SEEDREAM_5_IMAGE_SCHEMA)},
      params_pricing = ${JSON.stringify(CTYUN_SEEDREAM_5_PRICING)}
    FROM providers p
    WHERE p.id = pm.provider_id
      AND p.code = 'ctyun-edge'
      AND pm.code = 'ctyun-seedream-5.0-lite'
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_models pm
    SET
      category_references = ${JSON.stringify({
        text_to_image: SEEDREAM_IMAGE_CATEGORY_REFERENCES.text_to_image,
      })},
      params_schema = ${JSON.stringify({
        resolution: ['2k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        image: [],
      })},
      params_pricing = ${JSON.stringify([
        { resolution: '2k', model: 'ctyun-seedream-5.0-lite', unit_price: 4 },
      ])}
    FROM providers p
    WHERE p.id = pm.provider_id
      AND p.code = 'ctyun-edge'
      AND pm.code = 'ctyun-seedream-5.0-lite'
  `.execute(db)
}
