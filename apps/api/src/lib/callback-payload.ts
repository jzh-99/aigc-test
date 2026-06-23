// 异步回调载荷构建器
// 逐字对齐源项目 app/services/callbacks.py 的 build_async_callback_payload
// 及其调用的 6 个 meta 构造函数：_song_meta / _image_meta / _text_meta /
// _video_meta / _news_meta / _storybook_meta。podcast 在源项目里走 else
// 默认分支（{status, failed_reason} + media 展开 + 成功时 extra 展开）。
//
// 对外 JSON 契约字段拼写保持源项目原样：task_id / bussiness_id /
// image_url / music_url / audio_url 等，不得"修正"。
//
// 错误码与对外文案统一走 open-api-errors.ts：
// - 失败时 message 取 errorMessage(failureCode)（或 publicMessage 覆盖）
// - failed_reason 同上，成功时为 null
// - 不向客户端暴露内部异常文本

import { ErrorCode, errorMessage } from './open-api-errors'

// 支持的 service_type 集合（对齐源项目 6 类业务 + text 同步链路 + podcast）
export type CallbackServiceType =
  | 'image'
  | 'song'
  | 'video'
  | 'news'
  | 'podcast'
  | 'storybook'
  | 'text'

export interface BuildPayloadInput {
  serviceType: CallbackServiceType
  taskId: string
  bussinessId: string
  status: 'succeeded' | 'failed'
  // 供应商产出媒体字段：image_url / music_url / video_url / news_url /
  // audio_url / images_url / output_text，按 service_type 取用
  media: Record<string, unknown>
  // 额外元信息：song 的 title/duration/lyrics_sections/status、news 的 title/abstract
  extraMeta: Record<string, unknown>
  // 失败码，默认 SYSTEM_FAILED
  failureCode?: string
  // 对外文案覆盖（优先于 errorMessage(failureCode)）
  publicMessage?: string
}

// 构建异步回调载荷，返回 { result, meta } 结构
// 对齐源项目：text 分支不带 bussiness_id 且直接返回；其余带 bussiness_id
export function buildAsyncCallbackPayload(input: BuildPayloadInput): {
  result: Record<string, unknown>
  meta: Record<string, unknown>
} {
  const {
    serviceType,
    taskId,
    bussinessId,
    status,
    media,
    extraMeta,
  } = input

  const success = status === 'succeeded'
  const failureCode = input.failureCode ?? ErrorCode.SYSTEM_FAILED
  // publicMessage 优先；否则取固定文案（不泄漏内部异常）
  const publicFailedReason = input.publicMessage ?? errorMessage(failureCode)
  // 成功时 failed_reason 恒为 null
  const publicFailedReasonOrNone = success ? null : publicFailedReason
  const code = success ? ErrorCode.SUCCESS : failureCode

  const meta = buildMeta(serviceType, media, publicFailedReasonOrNone, status, extraMeta)

  // text 不带 bussiness_id（源项目 100-107 行直接 return）
  if (serviceType === 'text') {
    return {
      result: {
        task_id: taskId,
        code,
        message: success ? null : publicFailedReason,
      },
      meta,
    }
  }

  return {
    result: {
      task_id: taskId,
      bussiness_id: bussinessId,
      code,
      message: success ? null : publicFailedReason,
    },
    meta,
  }
}

// 按 service_type 构造 meta（逐字对齐源项目 _xxx_meta 函数）
function buildMeta(
  serviceType: CallbackServiceType,
  media: Record<string, unknown>,
  failedReason: string | null,
  status: 'succeeded' | 'failed',
  extra: Record<string, unknown>,
): Record<string, unknown> {
  switch (serviceType) {
    case 'song':
      // 源项目 _song_meta：status 取 extra_meta.get("status", 默认)，
      // 调用方在 build_async_callback_payload 里把 {**extra_meta, "status": status} 传入，
      // 因此这里 status 优先取 extra.status，回退到参数 status
      return {
        status: (extra.status as string) ?? status,
        failed_reason: failedReason,
        title: extra.title ?? null,
        music_url: media.music_url ?? null,
        image_url: media.image_url ?? null,
        duration: extra.duration ?? null,
        lyrics_sections: extra.lyrics_sections ?? null,
      }
    case 'image':
      return {
        status,
        failed_reason: failedReason,
        image_url: media.image_url ?? null,
      }
    case 'video':
      return {
        status,
        failed_reason: failedReason,
        video_url: media.video_url ?? null,
      }
    case 'news':
      return {
        status,
        failed_reason: failedReason,
        title: extra.title ?? null,
        // 源项目取 extra_meta.get("abstract")，但输出字段名为 news_abstract
        news_abstract: extra.abstract ?? null,
        news_url: media.news_url ?? null,
      }
    case 'storybook':
      // 源项目：media.get("images_url") or []（空值兜底为空数组）
      return {
        status,
        failed_reason: failedReason,
        images_url: media.images_url || [],
      }
    case 'text':
      // 源项目 _text_meta：成功时取 media.output_text 默认空串，失败时恒为空串
      return {
        output_text: failedReason === null ? ((media.output_text as string) ?? '') : '',
      }
    case 'podcast':
    default: {
      // 源项目 else 默认分支：{status, failed_reason} + media 展开，
      // 成功时再展开 extra_meta（失败时不展开 extra，避免内部细节泄漏）
      const meta: Record<string, unknown> = {
        status,
        failed_reason: failedReason,
      }
      Object.assign(meta, media)
      if (failedReason === null) {
        Object.assign(meta, extra)
      }
      return meta
    }
  }
}
