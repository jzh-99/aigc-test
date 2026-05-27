import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_models
    SET
      description = '音乐生成模型，按灵感歌曲、纯音乐、自定义歌曲三种业务模式配置价格',
      params_pricing = '[
        {"resolution":"inspiration_song","model":"mureka-8","unit_price":12},
        {"resolution":"instrumental","model":"mureka-8","unit_price":10},
        {"resolution":"custom_song","model":"mureka-8","unit_price":10}
      ]'::jsonb
    WHERE code = 'mureka-8'
      AND module = 'music'
  `.execute(db)

  await sql`
    UPDATE provider_models
    SET
      description = '高质量音乐生成模型，按灵感歌曲、纯音乐、自定义歌曲三种业务模式配置价格',
      params_pricing = '[
        {"resolution":"inspiration_song","model":"mureka-9","unit_price":18},
        {"resolution":"instrumental","model":"mureka-9","unit_price":15},
        {"resolution":"custom_song","model":"mureka-9","unit_price":15}
      ]'::jsonb
    WHERE code = 'mureka-9'
      AND module = 'music'
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_models
    SET
      description = '音乐生成模型，覆盖歌词、歌曲、纯音乐、封面和转存成本',
      params_pricing = '[
        {"resolution":"lyrics","model":"mureka-8","unit_price":2},
        {"resolution":"song","model":"mureka-8","unit_price":8},
        {"resolution":"instrumental","model":"mureka-8","unit_price":8},
        {"resolution":"cover","model":"mureka-8","unit_price":1},
        {"resolution":"transfer","model":"mureka-8","unit_price":1}
      ]'::jsonb
    WHERE code = 'mureka-8'
      AND module = 'music'
  `.execute(db)

  await sql`
    UPDATE provider_models
    SET
      description = '高质量音乐生成模型，覆盖歌词、歌曲、纯音乐、封面和转存成本',
      params_pricing = '[
        {"resolution":"lyrics","model":"mureka-9","unit_price":3},
        {"resolution":"song","model":"mureka-9","unit_price":12},
        {"resolution":"instrumental","model":"mureka-9","unit_price":12},
        {"resolution":"cover","model":"mureka-9","unit_price":1},
        {"resolution":"transfer","model":"mureka-9","unit_price":2}
      ]'::jsonb
    WHERE code = 'mureka-9'
      AND module = 'music'
  `.execute(db)
}
