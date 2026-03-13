import { getDb } from '@aigc/db'

interface FilterRule {
  id: string
  pattern: string
  type: 'keyword' | 'regex'
  action: 'reject' | 'flag'
  description: string | null
}

interface FilterResult {
  allowed: boolean
  ruleId?: string
  ruleLabel?: string
}

let cachedRules: FilterRule[] | null = null
let cacheExpiry = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function loadRules(): Promise<FilterRule[]> {
  const now = Date.now()
  if (cachedRules && now < cacheExpiry) return cachedRules

  const db = getDb()
  const rows = await db
    .selectFrom('prompt_filter_rules')
    .select(['id', 'pattern', 'type', 'action', 'description'])
    .where('is_active', '=', true)
    .execute()

  cachedRules = rows
  cacheExpiry = now + CACHE_TTL
  return rows
}

export async function checkPrompt(
  userId: string,
  prompt: string,
): Promise<FilterResult> {
  const rules = await loadRules()
  const lowerPrompt = prompt.toLowerCase()

  for (const rule of rules) {
    let matched = false

    if (rule.type === 'keyword') {
      matched = lowerPrompt.includes(rule.pattern.toLowerCase())
    } else if (rule.type === 'regex') {
      try {
        const re = new RegExp(rule.pattern, 'i')
        matched = re.test(prompt)
      } catch {
        // Skip invalid regex
      }
    }

    if (matched && rule.action === 'reject') {
      // Log rejection
      const db = getDb()
      await db
        .insertInto('prompt_filter_logs')
        .values({
          user_id: userId,
          prompt,
          matched_rules: JSON.stringify([{ id: rule.id, pattern: rule.pattern }]),
          action: 'rejected',
        })
        .execute()

      return {
        allowed: false,
        ruleId: rule.id,
        ruleLabel: rule.description ?? rule.pattern,
      }
    }
  }

  // Log pass
  const db = getDb()
  await db
    .insertInto('prompt_filter_logs')
    .values({
      user_id: userId,
      prompt,
      matched_rules: JSON.stringify([]),
      action: 'pass',
    })
    .execute()

  return { allowed: true }
}
