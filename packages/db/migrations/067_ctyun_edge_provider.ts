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

const MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES = {
  multimodal: {
    label: '全能参考',
    limits: {
      image: { min: 0, max: 10 },
      video: { min: 0, max: 5 },
      audio: { min: 0, max: 5 },
      text: { min: 0, max: 0 },
    },
  },
  frames: {
    label: '首尾帧',
    limits: {
      image: { min: 1, max: 2 },
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

const CTYUN_VIDEO_SCHEMA = {
  aspect_ratio: [{ label: '自适应', value: 'adaptive' }, '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  resolution: ['480p', '720p', '1080p'],
  time_length: [
    { label: '4秒', value: 4 },
    { label: '5秒', value: 5 },
    { label: '6秒', value: 6 },
    { label: '7秒', value: 7 },
    { label: '8秒', value: 8 },
    { label: '9秒', value: 9 },
    { label: '10秒', value: 10 },
    { label: '11秒', value: 11 },
    { label: '12秒', value: 12 },
    { label: '13秒', value: 13 },
    { label: '14秒', value: 14 },
    { label: '15秒', value: 15 },
  ],
  video_voice: [
    { label: '有声', value: true, default: true },
    { label: '无声', value: false, default: true },
  ],
  image: [],
}

export async function up(db: Kysely<any>): Promise<void> {
  const provider = await db
    .insertInto('providers')
    .values({
      code: 'ctyun-edge',
      name: '天翼云边缘AI网关',
      region: 'cn',
      modules: JSON.stringify(['image', 'video']),
      is_active: true,
      config: JSON.stringify({ api_base_url: 'https://ai.ctaigw.cn/v1' }),
    })
    .onConflict((oc) => oc.column('code').doUpdateSet({
      name: '天翼云边缘AI网关',
      region: 'cn',
      modules: JSON.stringify(['image', 'video']),
      is_active: true,
      config: JSON.stringify({ api_base_url: 'https://ai.ctaigw.cn/v1' }),
    }))
    .returning('id')
    .executeTakeFirstOrThrow()

  const models = [
    {
      code: 'ctyun-seedream-5.0-lite',
      name: 'Cdream 5.0 Lite',
      description: '天翼云边缘AI网关 ctyun-seedream-5.0-lite 图片生成',
      module: 'image',
      category_references: SEEDREAM_IMAGE_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: '2k', model: 'ctyun-seedream-5.0-lite', unit_price: 4 },
        { resolution: '3k', model: 'ctyun-seedream-5.0-lite', unit_price: 4 },
        { resolution: '4k', model: 'ctyun-seedream-5.0-lite', unit_price: 4 },
      ],
      params_schema: SEEDREAM_5_IMAGE_SCHEMA,
      resolution: '2k',
      is_active: false,
    },
    {
      code: 'ctyun-seedance-2.0',
      name: 'Cdance 2.0',
      description: '天翼云边缘AI网关 cdance2.0-0611 视频生成',
      module: 'video',
      category_references: MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: '480p', model: 'cdance2.0-0611', unit_price: 7 },
        { resolution: '720p', model: 'cdance2.0-0611', unit_price: 15 },
        { resolution: '1080p', model: 'cdance2.0-0611', unit_price: 35 },
      ],
      params_schema: CTYUN_VIDEO_SCHEMA,
      resolution: '720p',
      is_active: true,
    },
    {
      code: 'ctyun-seedance-2.0-fast',
      name: 'Cdance 2.0 Fast',
      description: '天翼云边缘AI网关 cdance2.0-fast-0611 视频生成',
      module: 'video',
      category_references: MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: '480p', model: 'cdance2.0-fast-0611', unit_price: 5 },
        { resolution: '720p', model: 'cdance2.0-fast-0611', unit_price: 12 },
      ],
      params_schema: { ...CTYUN_VIDEO_SCHEMA, resolution: ['480p', '720p'] },
      resolution: '720p',
      is_active: true,
    },
  ] as const

  for (const model of models) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: provider.id,
        code: model.code,
        name: model.name,
        description: model.description,
        module: model.module,
        category_references: JSON.stringify(model.category_references),
        params_pricing: JSON.stringify(model.params_pricing),
        params_schema: JSON.stringify(model.params_schema),
        resolution: model.resolution,
        is_active: model.is_active,
      })
      .onConflict((oc) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: model.name,
        description: model.description,
        module: model.module,
        category_references: JSON.stringify(model.category_references),
        params_pricing: JSON.stringify(model.params_pricing),
        params_schema: JSON.stringify(model.params_schema),
        resolution: model.resolution,
        is_active: model.is_active,
      }))
      .execute()
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DELETE FROM team_model_configs
    WHERE model_id IN (
      SELECT pm.id
      FROM provider_models pm
      INNER JOIN providers p ON p.id = pm.provider_id
      WHERE p.code = 'ctyun-edge'
    )
  `.execute(db)

  await sql`
    DELETE FROM provider_models
    WHERE provider_id IN (
      SELECT id FROM providers WHERE code = 'ctyun-edge'
    )
  `.execute(db)

  await db.deleteFrom('providers').where('code', '=', 'ctyun-edge').execute()
}
