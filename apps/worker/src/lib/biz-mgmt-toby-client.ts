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
  return {
    baseUrl: getRequiredEnv('TOBY_BASE_URL').replace(/\/$/, ''),
    appId: getRequiredEnv('TOBY_APP_ID'),
    appSecret: getRequiredEnv('TOBY_APP_SECRET'),
    privateKey: getRequiredEnv('TOBY_PRIVATE_KEY'),
  }
}

function getDesKey(privateKey: string): Buffer {
  const key = Buffer.from(privateKey, 'utf8')
  if (key.length < 8) throw new Error('TOBY_PRIVATE_KEY must be at least 8 bytes')
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
    return body
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

export interface BizMgmtMemberSubCardRequest {
  phone: string
  userName: string
  compName: string
  channel: string
  belongId: string
  initialPointsNum: number | string
}

// 创作结果同步 → AIHUB_CREATION_RESULT_NOTIFY
export function notifyBizMgmtCreationResult(payload: BizMgmtCreationResultRequest) {
  return callTobyApi('/api/toby/points/external/result-notify', 'AIHUB_CREATION_RESULT_NOTIFY', payload)
}

// 会员副卡同步 → MEMBER-1002
export function syncBizMgmtMemberSubCard(payload: BizMgmtMemberSubCardRequest) {
  return callTobyApi('/api/toby/member/sub-card', 'MEMBER-1002', payload)
}
