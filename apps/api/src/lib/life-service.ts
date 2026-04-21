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
  const baseUrl = process.env.LIFE_SERVICE_BASE_URL!

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

export function buildSignature(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return crypto.createHmac('sha1', secret).update(sorted).digest('hex')
}

export function buildRequestSignature(
  appId: string,
  nonce: string,
  timestamp: string,
  secret: string
): string {
  return buildSignature({ appId, nonce, timestamp }, secret)
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
  const secret = process.env.LIFE_SERVICE_SECRET!
  const baseUrl = process.env.LIFE_SERVICE_BASE_URL!

  const nonce = crypto.randomBytes(4).toString('hex')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = buildRequestSignature(appId, nonce, timestamp, secret)

  const token = await getLifeToken(redis)

  const res = await fetch(
    `${baseUrl}/LifeServiceInterface/toOrder/orderGenerate?signature=${signature}&appId=${appId}&nonce=${nonce}&timestamp=${timestamp}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: payload }),
    }
  )
  if (!res.ok) throw new Error(`orderGenerate failed: ${res.status}`)

  const body = await res.json() as Record<string, any>
  if (body.resultCode !== '0') throw new Error(`orderGenerate error: ${body.resultMsg}`)

  return body.data
}
