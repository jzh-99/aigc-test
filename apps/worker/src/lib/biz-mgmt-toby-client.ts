// worker 独立的业管外部接口 client。仅含创作结果同步、会员副卡同步两个包装，
// 复制自 apps/api/src/lib/toby-open-api.ts 的加解密/签名/调用骨架，不跨包 import api，
// 避免 worker → api 循环依赖。加解密逻辑必须与 api 侧保持一致。
import crypto from 'node:crypto'
import CryptoJS from 'crypto-js'

// ── 与 apps/api/src/lib/toby-open-api.ts 完全一致的加解密常量与逻辑 ──
const DES_IV = '12345678'
const SIGNATURE_VALID_SECONDS = Number(process.env.TOBY_SIGNATURE_VALID_SECONDS ?? 600)

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function getTobyConfig() {
  // 诊断：先把要读的环境变量都查一遍，缺哪个打哪个（替代「TOBY_xxx is required」的盲猜）
  const baseUrlRaw = process.env.TOBY_OUTBOUND_BASE_URL
  const appIdRaw = process.env.TOBY_OUTBOUND_APP_ID
  const appSecretRaw = process.env.TOBY_OUTBOUND_APP_SECRET
  const privateKeyRaw = process.env.TOBY_OUTBOUND_PRIVATE_KEY
  console.log(`[toby-client] env 探测: TOBY_OUTBOUND_BASE_URL=${baseUrlRaw ? '已配置' : '❌缺失'} appId=${appIdRaw ? '已配置' : '❌缺失'} appSecret=${appSecretRaw ? '已配置' : '❌缺失'} privateKey=${privateKeyRaw ? '已配置' : '❌缺失'}`)
  return {
    baseUrl: getRequiredEnv('TOBY_OUTBOUND_BASE_URL').replace(/\/$/, ''),
    appId: getRequiredEnv('TOBY_OUTBOUND_APP_ID'),
    appSecret: getRequiredEnv('TOBY_OUTBOUND_APP_SECRET'),
    privateKey: getRequiredEnv('TOBY_OUTBOUND_PRIVATE_KEY'),
  }
}

function getDesKey(privateKey: string): Buffer {
  const key = Buffer.from(privateKey, 'utf8')
  if (key.length < 8) throw new Error('TOBY_OUTBOUND_PRIVATE_KEY must be at least 8 bytes')
  return key.subarray(0, 8)
}

export function createTobySignature(timestamp: string, serviceCode: string): string {
  const { appId, appSecret } = getTobyConfig()
  const sortedForm = [
    ['appID', appId],
    ['appSecret', appSecret],
    ['serviceCode', serviceCode],
    ['timestamp', timestamp],
  ]
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return crypto.createHash('md5').update(sortedForm, 'utf8').digest('hex')
}

export function encryptTobyJson(payload: object): string {
  const { privateKey } = getTobyConfig()
  const key = CryptoJS.enc.Latin1.parse(getDesKey(privateKey).toString('latin1'))
  const iv = CryptoJS.enc.Utf8.parse(DES_IV)
  return CryptoJS.DES.encrypt(JSON.stringify(payload), key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString()
}

export function decryptTobyJson<T extends object>(encryptedValue: string): T {
  const { privateKey } = getTobyConfig()
  const key = CryptoJS.enc.Latin1.parse(getDesKey(privateKey).toString('latin1'))
  const iv = CryptoJS.enc.Utf8.parse(DES_IV)
  const text = CryptoJS.DES.decrypt(encryptedValue, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8)
  if (!text) throw new Error('Toby 加密报文解密失败')
  return JSON.parse(text) as T
}

export interface TobyApiResponse<T = unknown> {
  code: string
  message: string
  data?: unknown
  decryptedData?: T
}

// worker 侧通知仅需成功即可，不做响应验签回查（与 api 侧 callTobyApi 行为一致）
async function callTobyApi<T extends object>(
  path: string,
  serviceCode: string,
  payload: object,
): Promise<TobyApiResponse<T>> {
  const { baseUrl, appId } = getTobyConfig()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const requestPayload = { ...payload, appID: appId, timestamp, serviceCode, signature: createTobySignature(timestamp, serviceCode) }
  // 显式打印请求目标，便于排查「TOBY_OUTBOUND_BASE_URL 没配/配错」类问题
  console.log(`[toby-client] 请求 ${serviceCode} → ${baseUrl}${path}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appID: appId, requestJson: encryptTobyJson(requestPayload) }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Toby 接口请求失败：${response.status}`)
    const body = (await response.json()) as TobyApiResponse<T>
    console.log(`[toby-client] 响应 ${serviceCode} code=${body.code} message=${body.message}`)
    return body
  } catch (err) {
    console.log(`[toby-client] 异常 ${serviceCode}: ${err instanceof Error ? err.message : String(err)}`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export interface BizMgmtCreationResultRequest {
  userId: string
  requestNo: string
  workNo: string
  success: boolean
  remark?: string
}

// 业管 MEMBER-1002 会员副卡同步请求（2026-06-29 契约更新：移除 compName / channel）。
export interface BizMgmtMemberSubCardRequest {
  phone: string
  userName: string
  belongId: string
  initialPointsNum: number | string
}

export interface BizMgmtSubscribeRequest {
  requestNo: string
  exOrderNo: string
  phone: string
  channel: number
  source: string
  goodsId: string
  orderType: number
  payAmount: number | string
  status: number
  orderTime?: string
}

// 创作结果同步 → AIHUB_CREATION_RESULT_NOTIFY
export function notifyBizMgmtCreationResult(payload: BizMgmtCreationResultRequest) {
  return callTobyApi('/api/toby/points/external/result-notify', 'AIHUB_CREATION_RESULT_NOTIFY', payload)
}

// 会员副卡同步 → MEMBER-1002
export function syncBizMgmtMemberSubCard(payload: BizMgmtMemberSubCardRequest) {
  return callTobyApi('/api/toby/member/sub-card', 'MEMBER-1002', payload)
}

// 订购同步 → SUBSCRIBE_SERVICE_CODE_1001
// 充值/包月订单支付成功后通知业管，由业管负责给对应会员增加 A 豆，
// 本地不再维护余额（硬切换：本地积分系统已退役）。
export function syncBizMgmtSubscribe(payload: BizMgmtSubscribeRequest) {
  return callTobyApi('/api/toby/subscribe/external/dealExSubscribe', 'SUBSCRIBE_SERVICE_CODE_1001', payload)
}
