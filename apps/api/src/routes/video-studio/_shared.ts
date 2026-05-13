// video-studio 模块共享辅助函数
// autoload 会忽略以 _ 开头的文件，此文件仅供同目录路由 import

import { getDb } from '@aigc/db'

// 调用 LLM（nano_banana OpenAI 兼容接口）
export async function callLLM(systemPrompt: string, userPrompt: string, maxTokens = 4000): Promise<string> {
  const AI_API_URL = process.env.NANO_BANANA_API_URL ?? ''
  const AI_API_KEY = process.env.NANO_BANANA_API_KEY ?? ''
  const AI_MODEL = process.env.NANO_BANANA_MODEL ?? ''

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const res = await fetch(`${AI_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        stream: false,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`LLM error ${res.status}`)
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

// 从原始字符串中提取第一个 JSON 对象
export function parseJSON<T>(raw: string): T | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    return JSON.parse(m[0]) as T
  } catch {
    return null
  }
}

// 校验项目访问权限，requireDelete=true 时还需校验是否为项目所有者或管理员
export async function assertProjectAccess(projectId: string, userId: string, requireDelete = false) {
  const db = getDb()
  const project = await db
    .selectFrom('video_studio_projects')
    .select(['workspace_id', 'user_id'])
    .where('id', '=', projectId)
    .executeTakeFirst()
  if (!project) return null

  const member = await db
    .selectFrom('workspace_members')
    .select('role')
    .where('workspace_id', '=', project.workspace_id)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  if (!member) return null
  if (requireDelete && project.user_id !== userId && member.role !== 'admin') return null
  return { project, member }
}
