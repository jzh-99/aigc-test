// 开放接口音乐生成路由（Phase 3）。
//
// 对齐源项目 app/api/routes_song.py:submit_song_generation 的链路：
//   1. 校验 schema（task_id/model/promt/gender/instrumental/callback_url 必填，
//      bussiness_id/tag 可空）
//   2. 字段适配：源 SongGenerateRequest → aigc-test music worker 语义
//      （promt→prompt、gender→voice_gender、tag→styles、instrumental→type/mode）
//   3. createOpenApiBatch 事务内建 task_batches + tasks（source=open_api，幂等防重复）
//   4. 额外建 music_tracks 记录（music worker 通过 trackId 读该表，
//      获取 prompt/lyrics/styles/voice_gender/mode/type 等生成参数）
//   5. getMusicQueue().add 投递 music-queue，jobData 字段对齐 MusicJobData
//   6. 返回 successResponse(task_id)
//
// 字段拼写约定（源项目契约，不得"修正"）：
//   - 请求体 promt（少一个 p）、bussiness_id（多一个 s）—— 路由映射到内部规范字段
//   - 内部 jobData/DB 用 prompt/businessId
//
// 字段适配映射（核心，详见 adaptSongParams 注释）：
//   - 源 gender '0'/'1'/'2' → aigc-test voice_gender 'auto'/'male'/'female'
//     （注：源 mureka.py 把 '0' 视为男声，但 aigc-test 的 MusicVoiceGender 枚举
//      'auto'/'male'/'female'，'auto' 表示随机。源 '0' 文案为"男声演唱"，
//      但 '2' 文案为"随机选择演唱性别"。为对齐 aigc-test 语义，'0'→'auto'
//      让 Mureka 随机选声，避免与 'male' 语义冲突；实际演唱性别由 Mureka 决定）
//   - 源 instrumental '1' → type='instrumental'（纯音乐，跳过歌词生成）；
//     '0' → type='song'（灵感模式，歌词+曲），mode 恒 'inspiration'
//   - 源 tag → styles（按分隔符拆分数组）
import type { FastifyPluginAsync } from 'fastify'

import { getMusicQueue } from '../../lib/queue.js'
import { getDb } from '@aigc/db'
import { successResponse } from '../../lib/open-api-errors.js'
import type { MusicModel, MusicTrackType, MusicVoiceGender } from '@aigc/types'
import { createOpenApiBatch, openApiPreHandler } from './_shared.js'

// 请求体 schema（对齐源 SongGenerateRequest）
// gender/instrumental 为 string 枚举（源 pydantic field_validator 校验字符串值）
// bussiness_id/tag 可空（源 Field(default=None)）
// promt 拼写为对外契约，不得修正
const LYRICS_BODY = {
  type: 'object',
  required: ['task_id', 'model', 'promt', 'gender', 'instrumental', 'callback_url'],
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', maxLength: 50 },
    bussiness_id: { type: 'string', maxLength: 50 },
    model: { type: 'string' },
    promt: { type: 'string' },
    gender: { type: 'string', enum: ['0', '1', '2'] },
    tag: { type: 'string' },
    instrumental: { type: 'string', enum: ['0', '1'] },
    callback_url: { type: 'string', format: 'uri' },
  },
}

// 源 gender 字符串 → aigc-test MusicVoiceGender 枚举
// 源 mureka.py：'0'=男声、'1'=女声、'2'=随机；aigc-test 枚举 'auto'/'male'/'female'
// 映射：'0'→'male'（男声）、'1'→'female'（女声）、'2'→'auto'（随机）
// 注：以 aigc-test MusicVoiceGender 枚举值为准，'auto' 即随机选声
const GENDER_MAP: Record<string, MusicVoiceGender> = {
  '0': 'male',
  '1': 'female',
  '2': 'auto',
}

// tag 分隔符：源项目未明确，按常见分隔符（逗号/顿号/分号/竖线/空格）拆分
// 拆分后过滤空串，去重保序
function splitTagToStyles(tag: string | null | undefined): string[] {
  if (!tag) return []
  const parts = tag.split(/[,，;；|、\s]+/).map((s) => s.trim()).filter(Boolean)
  return Array.from(new Set(parts))
}

// 源 SongGenerateRequest 字段适配到 aigc-test music worker 语义
//
// 输出字段对齐 music_tracks 表 + music worker 读取的 MusicBatchParams：
//   - prompt：源 promt（音乐灵感描述，music worker buildMurekaGenerationPrompt 使用）
//   - type：源 instrumental '1'→'instrumental'（纯音乐），'0'→'song'（歌曲）
//   - mode：恒 'inspiration'（源链路是灵感模式：Mureka 自动生成歌词+曲）
//   - voiceGender：源 gender 映射
//   - styles：源 tag 拆分数组
export interface AdaptedSongParams {
  prompt: string
  type: MusicTrackType
  mode: 'inspiration'
  voiceGender: MusicVoiceGender
  styles: string[]
}

export function adaptSongParams(input: {
  promt: string
  gender: string
  instrumental: string
  tag?: string | null
}): AdaptedSongParams {
  const isInspirational = input.instrumental !== '1'
  return {
    prompt: input.promt,
    type: isInspirational ? 'song' : 'instrumental',
    mode: 'inspiration',
    voiceGender: GENDER_MAP[input.gender] ?? 'auto',
    styles: splitTagToStyles(input.tag),
  }
}

const route: FastifyPluginAsync = async (app) => {
  app.post('/lyrics/generate', {
    schema: { tags: ['OpenApi'], body: LYRICS_BODY },
    preHandler: [openApiPreHandler],
  }, async (request, reply) => {
    const b = request.body as {
      task_id: string
      bussiness_id?: string | null
      model: string
      promt: string
      gender: string
      tag?: string | null
      instrumental: string
      callback_url: string
    }
    // preHandler 已挂载 request.apiClient（非空断言：openApiPreHandler 失败会抛 AUTH_FAILED）
    const apiClient = request.apiClient!

    // ① 字段适配：源 SongGenerateRequest → aigc-test music worker 语义
    const adapted = adaptSongParams({
      promt: b.promt,
      gender: b.gender,
      instrumental: b.instrumental,
      tag: b.tag,
    })

    // bussiness_id 源可空，适配为空串（DB business_id 为 nullable，但回调契约传空串）
    const bussinessId = b.bussiness_id ?? ''

    // ② 建 task_batches + tasks（事务内，幂等防重复），返回 batchId/internalTaskId/creditAccountId
    //    module='music'、serviceType='song'（对齐源 callbacks.py 的 _song_meta）
    //    params 快照写入 worker 读取的 MusicBatchParams 字段（mode/track_type/styles/voice_gender 等）
    const { batchId, internalTaskId, creditAccountId } = await createOpenApiBatch({
      apiClient,
      serviceType: 'song',
      taskId: b.task_id,
      bussinessId,
      callbackUrl: b.callback_url,
      module: 'music',
      provider: 'mureka',
      model: b.model,
      prompt: b.promt,
      params: {
        // music worker parseMusicBatchParams 读取的字段（对齐 MusicBatchParams）
        mode: adapted.mode,
        track_type: adapted.type,
        title: null,
        lyrics: null,
        styles: adapted.styles,
        voice_gender: adapted.voiceGender,
        voice_clone_id: null,
        voice_id: null,
        // 源字段快照（便于排查，worker 不消费）
        source_gender: b.gender,
        source_instrumental: b.instrumental,
        source_tag: b.tag ?? null,
      },
    })

    // ③ 额外建 music_tracks 记录
    //    music worker 第 258-264 行通过 data.trackId 从 music_tracks 表读取
    //    prompt/lyrics/styles/voice_gender/mode/type 等生成参数。
    //    若不建此记录，worker 会 executeTakeFirstOrThrow 抛错。
    //    字段对齐现有 post-generate.ts 的 music_tracks 插入语义。
    const db = getDb()
    const track = await db
      .insertInto('music_tracks')
      .values({
        workspace_id: apiClient.workspaceId!,
        user_id: apiClient.systemUserId!,
        team_id: apiClient.teamId!,
        batch_id: batchId,
        task_id: internalTaskId,
        type: adapted.type,
        mode: adapted.mode,
        title: null,
        prompt: adapted.prompt,
        lyrics: null,
        styles: JSON.stringify(adapted.styles),
        voice_clone_id: null,
        voice_gender: adapted.voiceGender,
        model: b.model as MusicModel,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    // ④ 投递音乐生成队列
    //    jobData 字段对齐 MusicJobData（packages/types）：
    //      - taskId/batchId/trackId/userId/teamId/workspaceId/creditAccountId/estimatedCredits 必填
    //    回调字段（callbackUrl/businessId/serviceType/openApiTaskId）非 MusicJobData 契约字段，
    //    但与 GenerationJobData 对齐保留；music worker 完成后通过查 task_batches 表
    //    获取 source/callback_url/business_id/task_id 做分流（不依赖 jobData 透传）
    await getMusicQueue().add('music-generate', {
      taskId: internalTaskId,
      batchId,
      trackId: track.id,
      userId: apiClient.systemUserId!,
      teamId: apiClient.teamId!,
      workspaceId: apiClient.workspaceId!,
      creditAccountId,
      estimatedCredits: 0,
      callbackUrl: b.callback_url,
      businessId: bussinessId,
      serviceType: 'song',
      openApiTaskId: b.task_id,
    })

    // ⑤ 立即返回成功信封（异步链路由 worker 处理）
    return reply.send(successResponse(b.task_id))
  })
}

export default route
