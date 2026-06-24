import crypto from 'node:crypto'
import CryptoJS from 'crypto-js'

const DES_IV = '12345678'
const SIGNATURE_VALID_SECONDS = Number(process.env.TOBY_SIGNATURE_VALID_SECONDS ?? 600)

export const TOBY_SERVICE_CODES = {
  memberLoginInfo: 'MEMBER-1001',
  pointsChangeQuery: 'AIHUB_POINTS_CHANGE_QUERY',
  pointsChange: 'AIHUB_POINTS_CHANGE',
  creationResultNotify: 'AIHUB_CREATION_RESULT_NOTIFY',
  subscribe: 'SUBSCRIBE_SERVICE_CODE_1001',
  memberSubCard: 'MEMBER-1002',
  specificationConfig: 'SPECIFICATION-COFIG',
} as const

export type TobyServiceCode = typeof TOBY_SERVICE_CODES[keyof typeof TOBY_SERVICE_CODES]

export interface TobyEnvelope {
  appID: string
  requestJson?: string
  responseJson?: string
}

export interface TobyApiResponse<T = unknown> {
  code: string
  message: string
  data?: TobyEnvelope | string | null
  decryptedData?: T
}

export interface TobyMemberLoginInfoRequest {
  phone: string
  userName: string
  compName?: string
  channel: string
  userType: string
}

export interface TobyPointsChangeQueryRequest {
  userId: string
  changeType?: string
  pageNum: number
  pageSize: number
}

export interface TobyPointsChangeRequest {
  userId: string
  requestNo: string
  workNo: string
  pointsNum: number | string
  remark?: string
}

export interface TobyCreationResultNotifyRequest {
  userId: string
  requestNo: string
  workNo: string
  success: boolean
  remark?: string
}

export interface TobySubscribeRequest {
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

export interface TobyMemberSubCardRequest {
  phone: string
  userName: string
  compName: string
  channel: string
  belongId: string
  initialPointsNum: number | string
}

export interface TobySpecificationConfigPayload {
  timestamp: string
  signature: string
  serviceCode: string
  appID: string
  requestNo?: string
  modeCode: string
  modeType: string
  modeName: string
  modelDesc: string
  modelProvider: string
  resolutionRatio: string
  singleConsumeCount: number
  inputConsumeCount: number
  ouputConsumeCount: number
}

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
    .map(([key, value]) => `${key}=${value}`)
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

export function decryptTobyJson<T extends object = Record<string, unknown>>(
  encryptedValue: string,
): T {
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

export function buildTobyRequest(
  serviceCode: TobyServiceCode,
  payload: object,
): TobyEnvelope {
  const { appId } = getTobyConfig()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const requestPayload = {
    ...payload,
    appID: appId,
    timestamp,
    serviceCode,
    signature: createTobySignature(timestamp, serviceCode),
  }

  return {
    appID: appId,
    requestJson: encryptTobyJson(requestPayload),
  }
}

function assertTobySignature(payload: Record<string, unknown>, serviceCode: TobyServiceCode): void {
  const { appId } = getTobyConfig()
  const responseAppId = String(payload.appID ?? '')
  const timestamp = String(payload.timestamp ?? '')
  const signature = String(payload.signature ?? '')
  const actualServiceCode = String(payload.serviceCode ?? '')

  if (responseAppId !== appId) throw new Error('Toby appID 不匹配')
  if (actualServiceCode !== serviceCode) throw new Error('Toby serviceCode 不匹配')
  if (!timestamp || !signature) throw new Error('Toby 签名字段缺失')

  const responseTime = Number(timestamp)
  if (!Number.isFinite(responseTime)) throw new Error('Toby timestamp 格式错误')
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - responseTime) > SIGNATURE_VALID_SECONDS) {
    throw new Error('Toby 签名已过期')
  }

  const expected = createTobySignature(timestamp, serviceCode)
  if (signature !== expected) throw new Error('Toby 签名校验失败')
}

export function decryptAndVerifyTobyResponse<T extends object>(
  envelope: TobyEnvelope,
  serviceCode: TobyServiceCode,
): T {
  const { appId } = getTobyConfig()
  if (envelope.appID !== appId || !envelope.responseJson) {
    throw new Error('Toby 响应外层报文异常')
  }
  const payload = decryptTobyJson<T>(envelope.responseJson)
  assertTobySignature(payload as Record<string, unknown>, serviceCode)
  return payload
}

export function decryptAndVerifyTobyRequest<T extends object>(
  envelope: TobyEnvelope,
  serviceCode: TobyServiceCode,
): T {
  const { appId } = getTobyConfig()
  if (envelope.appID !== appId || !envelope.requestJson) {
    throw new Error('Toby 请求外层报文异常')
  }
  const payload = decryptTobyJson<T>(envelope.requestJson)
  assertTobySignature(payload as Record<string, unknown>, serviceCode)
  return payload
}

export function buildTobyResponse(
  serviceCode: TobyServiceCode,
  payload: object,
): TobyEnvelope {
  const { appId } = getTobyConfig()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const responsePayload = {
    ...payload,
    appID: appId,
    timestamp,
    serviceCode,
    signature: createTobySignature(timestamp, serviceCode),
  }

  return {
    appID: appId,
    responseJson: encryptTobyJson(responsePayload),
  }
}

function parseTobyEnvelope(value: TobyEnvelope | string | null | undefined): TobyEnvelope | null {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value) as TobyEnvelope
  } catch {
    throw new Error('Toby 响应 data 不是合法 JSON')
  }
}

async function callTobyApi<T extends object>(
  path: string,
  serviceCode: TobyServiceCode,
  payload: object,
): Promise<TobyApiResponse<T>> {
  const { baseUrl } = getTobyConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTobyRequest(serviceCode, payload)),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`Toby 接口请求失败：${response.status}`)

    const body = await response.json() as TobyApiResponse<T>
    const envelope = parseTobyEnvelope(body.data)
    if (body.code === '0000' && envelope) {
      body.decryptedData = decryptAndVerifyTobyResponse<T>(envelope, serviceCode)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

export function queryTobyMemberLoginInfo(payload: TobyMemberLoginInfoRequest) {
  return callTobyApi('/api/toby/member/login-info', TOBY_SERVICE_CODES.memberLoginInfo, payload)
}

export function queryTobyPointsChangeList(payload: TobyPointsChangeQueryRequest) {
  return callTobyApi('/api/toby/points/external/change-list', TOBY_SERVICE_CODES.pointsChangeQuery, payload)
}

export function deductTobyPoints(payload: TobyPointsChangeRequest) {
  return callTobyApi('/api/toby/points/external/change', TOBY_SERVICE_CODES.pointsChange, payload)
}

export function notifyTobyCreationResult(payload: TobyCreationResultNotifyRequest) {
  return callTobyApi('/api/toby/points/external/result-notify', TOBY_SERVICE_CODES.creationResultNotify, payload)
}

export function syncTobySubscribe(payload: TobySubscribeRequest) {
  return callTobyApi('/api/aihub/subscribe/external/dealExSubscribe', TOBY_SERVICE_CODES.subscribe, payload)
}

export function syncTobyMemberSubCard(payload: TobyMemberSubCardRequest) {
  return callTobyApi('/api/toby/member/sub-card', TOBY_SERVICE_CODES.memberSubCard, payload)
}
