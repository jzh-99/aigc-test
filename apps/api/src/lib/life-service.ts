import crypto from 'node:crypto'
import type { Redis } from 'ioredis'

const TOKEN_CACHE_KEY = 'life_service:token'

export interface LifeToken {
  token: string
  expiresIn: number
}

export async function getLifeToken(redis: Redis): Promise<string> {
  const cached = await redis.get(TOKEN_CACHE_KEY)
  if (cached) return cached

  const appId = process.env.LIFE_SERVICE_APP_ID!
  const secret = process.env.LIFE_SERVICE_SECRET!
  const baseUrl = process.env.LIFE_SERVICE_BASE_URL!.replace(/\/$/, '')

  const res = await fetch(
    `${baseUrl}/LifeServiceInterface/token/getToken?appId=${appId}&secret=${secret}`
  )
  if (!res.ok) throw new Error(`getToken failed: ${res.status}`)

  const body = await res.json() as Record<string, any>
  if (body.resultCode !== '0') throw new Error(`getToken error: ${body.resultMsg}`)

  const { token, expiresIn } = body.data as LifeToken
  // cache with 60s buffer
  await redis.set(TOKEN_CACHE_KEY, token, 'EX', Math.max(expiresIn - 60, 60))
  return token
}

// URL 参数签名: [appId, token, nonce, timestamp] 字典序排序后拼接，SHA-1
export function buildRequestSignature(
  appId: string,
  token: string,
  nonce: string,
  timestamp: string,
): string {
  const list = [appId, token, nonce, timestamp]
  list.sort()
  return crypto.createHash('sha1').update(list.join('')).digest('hex')
}

// 业务数据签名: Java JSONObject.toString() 按字母排序 key，Base64 编码后 SHA-1
export function buildDataSignature(data: Record<string, string>): string {
  const sorted = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]]))
  const base64 = Buffer.from(JSON.stringify(sorted)).toString('base64')
  return crypto.createHash('sha1').update(base64).digest('hex')
}

export function buildPaySign(
  orderId: string,
  amount: string,
  userId: string,
  showUrl: string
): string {
  const base64 = Buffer.from(
    `orderId=${orderId}&c=${amount}&userid=${userId}&show_uri=${showUrl}`
  ).toString('base64')
  return crypto.createHash('sha1').update(base64).digest('hex')
}

export async function createLifeOrder(
  redis: Redis,
  payload: Record<string, unknown>
): Promise<{ orderid: string; userid: string; orderType: string }> {
  const appId = process.env.LIFE_SERVICE_APP_ID!
  const baseUrl = process.env.LIFE_SERVICE_BASE_URL!.replace(/\/$/, '')

  const nonce = String(Date.now())
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const timestamp =
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())

  const token = await getLifeToken(redis)
  const sigina = buildRequestSignature(appId, token, nonce, timestamp)

  // data must be sorted by key (mirrors Java JSONObject.toString() behaviour)
  const sortedData = Object.fromEntries(
    Object.keys(payload).sort().map((k) => [k, payload[k]])
  )
  const sig = buildDataSignature(sortedData as Record<string, string>)

  const reqUrl = `${baseUrl}/LifeServiceInterface/toOrder/orderGenerate?appId=${appId}&timestamp=${timestamp}&nonce=${nonce}&signature=${sigina}`
  const reqBody = JSON.stringify({ data: sortedData, signature: sig })

  const res = await fetch(reqUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: reqBody,
  })
  if (!res.ok) throw new Error(`orderGenerate failed: ${res.status}`)

  const body = await res.json() as Record<string, any>
  if (body.resultCode !== '0') throw new Error(`orderGenerate error: ${body.resultMsg}`)

  return body.data
}

// 计算下次扣款日期（下个月同日，最大 28 日）
function nextMonthExecuteTime(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  const day = Math.min(d.getDate(), 28)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(day)}`
}

export async function createLifeSubscriptionOrder(
  redis: Redis,
  payload: Record<string, unknown>
): Promise<{ orderid: string; userid: string; orderType: string }> {
  const appId = process.env.LIFE_SERVICE_APP_ID!
  const baseUrl = process.env.LIFE_SERVICE_BASE_URL!.replace(/\/$/, '')
  const templateCode = process.env.LIFE_SERVICE_TEMPLATE_CODE!
  const skuId = process.env.LIFE_SERVICE_SKU_ID!
  const spuId = process.env.LIFE_SERVICE_SPU_ID!
  const areaCode = process.env.LIFE_SERVICE_AREA_CODE ?? '025'

  const nonce = String(Date.now())
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const timestamp =
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())

  const token = await getLifeToken(redis)
  const sigina = buildRequestSignature(appId, token, nonce, timestamp)

  const amountYuan = String(payload.AMOUNT)
  const memberId = String(payload.MEMBER_ID)

  const data: Record<string, unknown> = {
    ...payload,
    bss: '1',
    memberCode: {
      account: memberId,
      areaCode,
      goodsInfo: { skuId, spuId },
      phoneType: '1',
      type: '2',
    },
    signCallbackUrl: `${process.env.API_BASE_URL}/api/v1/payment/subscription-notify`,
    template_code: [
      {
        code: templateCode,
        period_rule_params: {
          execute_time: nextMonthExecuteTime(),
          period: '1',
          period_type: 'MONTH',
          single_amount: amountYuan,
        },
        type: 'alipay',
      },
    ],
  }

  const sortedData = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]]))
  const sig = buildDataSignature(sortedData as Record<string, string>)

  const res = await fetch(
    `${baseUrl}/LifeServiceInterface/agreementPay/orderGenerate?appId=${appId}&timestamp=${timestamp}&nonce=${nonce}&signature=${sigina}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: sortedData, signature: sig }),
    }
  )
  if (!res.ok) throw new Error(`subscriptionOrderGenerate failed: ${res.status}`)

  const body = await res.json() as Record<string, any>
  if (body.resultCode !== '0') throw new Error(`subscriptionOrderGenerate error: ${body.resultMsg}`)

  return body.data
}
