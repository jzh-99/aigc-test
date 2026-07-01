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
  specificationConfig: 'SPECIFICATION-CONFIG',
  memberRegister: 'MEMBER-1003',
  memberPoints: 'MEMBER-1004',
  memberPointsChange: 'MEMBER-1005',
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

interface TobyCryptoConfig {
  appId: string
  appSecret: string
  privateKey: string
}

interface TobyOutboundConfig extends TobyCryptoConfig {
  baseUrl: string
}

export interface TobyMemberLoginInfoRequest {
  phone: string
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
  source: number
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

// 业管 MEMBER-1002 会员副卡同步请求（契约演进：移除 compName / channel / initialPointsNum）。
// 副卡创建后不再支持配置初始 A 豆额度，仅保留 phone/userName/belongId 三个业务字段。
export interface TobyMemberSubCardRequest {
  phone: string
  userName: string
  belongId: string
}

// 业管 MEMBER-1002 响应解密载荷：新建成功时回传副卡会员编号 userId。
// 「会员已存在」时业管不一定回传 userId，调用方需用 MEMBER-1001 补查。
export interface TobyMemberSubCardResponse {
  userId?: string
}

export interface TobyMemberRegisterRequest {
  phone: string
  userName: string
  channel: string
}

export interface TobyMemberPointsRequest {
  userId: string
}

// 业管 MEMBER-1005 会员副卡 A豆变动请求。
// 由公司主卡对名下副卡发起：mainUserId=操作主卡会员编号，subUserId=被变更副卡会员编号，
// changeType=1副卡增加 / 2副卡扣减，pointsNum=A豆数量(BigDecimal)。
// timestamp/signature/serviceCode 由 buildTobyRequest 自动注入，调用方无需关心。
export interface TobyMemberPointsChangeRequest {
  mainUserId: string
  subUserId: string
  changeType: 1 | 2
  pointsNum: number | string
}

// 业管 MEMBER-1005 响应解密载荷：变更后主副卡最新 A豆余额（业管权威，单位 A豆）。
// 字段缺失时调用方按容错跳过对应缓存写入。
export interface TobyMemberPointsChangeResponse {
  mainBalancePointsNum?: number | string
  subBalancePointsNum?: number | string
}

export interface TobySpecificationConfigPayload {
  timestamp: string
  signature: string
  serviceCode: string
  appID: string
  requestNo?: string
  modelParams: {
    modelCode: string
    modelType: string
    modelName: string
    modelDesc: string
    modelProvider: string
    modelStatus?: number | string
    useChannel: string
    singleUnit: string
    materialRatio: string
    params: Array<{
      resolutionRatio: string
      singleConsumeCount: number
      inputConsumeCount?: number
      ouputConsumeCount?: number
    }>
  }
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function getTobyOutboundConfig(): TobyOutboundConfig {
  return {
    baseUrl: getRequiredEnv('TOBY_OUTBOUND_BASE_URL').replace(/\/$/, ''),
    appId: getRequiredEnv('TOBY_OUTBOUND_APP_ID'),
    appSecret: getRequiredEnv('TOBY_OUTBOUND_APP_SECRET'),
    privateKey: getRequiredEnv('TOBY_OUTBOUND_PRIVATE_KEY'),
  }
}

function getTobyInboundConfig(): TobyCryptoConfig {
  return {
    appId: getRequiredEnv('TOBY_INBOUND_APP_ID'),
    appSecret: getRequiredEnv('TOBY_INBOUND_APP_SECRET'),
    privateKey: getRequiredEnv('TOBY_INBOUND_PRIVATE_KEY'),
  }
}

function getDesKey(privateKey: string, envName: string): Buffer {
  const key = Buffer.from(privateKey, 'utf8')
  if (key.length < 8) throw new Error(`${envName} must be at least 8 bytes`)
  return key.subarray(0, 8)
}

function createTobySignatureWithConfig(
  config: TobyCryptoConfig,
  timestamp: string,
  serviceCode: string,
): string {
  const sortedForm = [
    ['appID', config.appId],
    ['appSecret', config.appSecret],
    ['serviceCode', serviceCode],
    ['timestamp', timestamp],
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join('&')

  return crypto.createHash('md5').update(sortedForm, 'utf8').digest('hex')
}

export function createTobySignature(timestamp: string, serviceCode: string): string {
  return createTobySignatureWithConfig(getTobyOutboundConfig(), timestamp, serviceCode)
}

function encryptTobyJsonWithConfig(payload: object, config: TobyCryptoConfig, privateKeyEnvName: string): string {
  const key = CryptoJS.enc.Latin1.parse(getDesKey(config.privateKey, privateKeyEnvName).toString('latin1'))
  const iv = CryptoJS.enc.Utf8.parse(DES_IV)
  return CryptoJS.DES.encrypt(JSON.stringify(payload), key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString()
}

export function encryptTobyJson(payload: object): string {
  return encryptTobyJsonWithConfig(payload, getTobyOutboundConfig(), 'TOBY_OUTBOUND_PRIVATE_KEY')
}

function decryptTobyJsonWithConfig<T extends object = Record<string, unknown>>(
  encryptedValue: string,
  config: TobyCryptoConfig,
  privateKeyEnvName: string,
): T {
  const key = CryptoJS.enc.Latin1.parse(getDesKey(config.privateKey, privateKeyEnvName).toString('latin1'))
  const iv = CryptoJS.enc.Utf8.parse(DES_IV)
  const text = CryptoJS.DES.decrypt(encryptedValue, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8)
  if (!text) throw new Error('Toby 加密报文解密失败')
  return JSON.parse(text) as T
}

export function decryptTobyJson<T extends object = Record<string, unknown>>(
  encryptedValue: string,
): T {
  return decryptTobyJsonWithConfig<T>(
    encryptedValue,
    getTobyOutboundConfig(),
    'TOBY_OUTBOUND_PRIVATE_KEY',
  )
}

export function buildTobyRequest(
  serviceCode: TobyServiceCode,
  payload: object,
): TobyEnvelope {
  const config = getTobyOutboundConfig()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const requestPayload = {
    ...payload,
    appID: config.appId,
    timestamp,
    serviceCode,
    signature: createTobySignatureWithConfig(config, timestamp, serviceCode),
  }

  return {
    appID: config.appId,
    requestJson: encryptTobyJsonWithConfig(requestPayload, config, 'TOBY_OUTBOUND_PRIVATE_KEY'),
  }
}

function assertTobySignature(
  payload: Record<string, unknown>,
  serviceCode: TobyServiceCode,
  config: TobyCryptoConfig,
): void {
  const responseAppId = String(payload.appID ?? '')
  const timestamp = String(payload.timestamp ?? '')
  const signature = String(payload.signature ?? '')
  const actualServiceCode = String(payload.serviceCode ?? '')

  if (responseAppId !== config.appId) throw new Error('Toby appID 不匹配')
  if (actualServiceCode !== serviceCode) throw new Error('Toby serviceCode 不匹配')
  if (!timestamp || !signature) throw new Error('Toby 签名字段缺失')

  const responseTime = Number(timestamp)
  if (!Number.isFinite(responseTime)) throw new Error('Toby timestamp 格式错误')
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - responseTime) > SIGNATURE_VALID_SECONDS) {
    throw new Error('Toby 签名已过期')
  }

  const expected = createTobySignatureWithConfig(config, timestamp, serviceCode)
  if (signature !== expected) throw new Error('Toby 签名校验失败')
}

export function decryptAndVerifyTobyResponse<T extends object>(
  envelope: TobyEnvelope,
  serviceCode: TobyServiceCode,
): T {
  const config = getTobyOutboundConfig()
  if (envelope.appID !== config.appId || !envelope.responseJson) {
    throw new Error('Toby 响应外层报文异常')
  }
  const payload = decryptTobyJsonWithConfig<T>(
    envelope.responseJson,
    config,
    'TOBY_OUTBOUND_PRIVATE_KEY',
  )
  assertTobySignature(payload as Record<string, unknown>, serviceCode, config)
  return payload
}

export function decryptAndVerifyTobyRequest<T extends object>(
  envelope: TobyEnvelope,
  serviceCode: TobyServiceCode,
): T {
  const config = getTobyOutboundConfig()
  if (envelope.appID !== config.appId || !envelope.requestJson) {
    throw new Error('Toby 请求外层报文异常')
  }
  const payload = decryptTobyJsonWithConfig<T>(
    envelope.requestJson,
    config,
    'TOBY_OUTBOUND_PRIVATE_KEY',
  )
  assertTobySignature(payload as Record<string, unknown>, serviceCode, config)
  return payload
}

export function buildTobyResponse(
  serviceCode: TobyServiceCode,
  payload: object,
): TobyEnvelope {
  const config = getTobyOutboundConfig()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const responsePayload = {
    ...payload,
    appID: config.appId,
    timestamp,
    serviceCode,
    signature: createTobySignatureWithConfig(config, timestamp, serviceCode),
  }

  return {
    appID: config.appId,
    responseJson: encryptTobyJsonWithConfig(responsePayload, config, 'TOBY_OUTBOUND_PRIVATE_KEY'),
  }
}

export function decryptAndVerifyTobyInboundRequest<T extends object>(
  envelope: TobyEnvelope,
  serviceCode: TobyServiceCode,
): T {
  const config = getTobyInboundConfig()
  if (envelope.appID !== config.appId || !envelope.requestJson) {
    throw new Error('Toby 请求外层报文异常')
  }
  const payload = decryptTobyJsonWithConfig<T>(
    envelope.requestJson,
    config,
    'TOBY_INBOUND_PRIVATE_KEY',
  )
  assertTobySignature(payload as Record<string, unknown>, serviceCode, config)
  return payload
}

export function buildTobyInboundResponse(
  serviceCode: TobyServiceCode,
  payload: object,
): TobyEnvelope {
  const config = getTobyInboundConfig()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const responsePayload = {
    ...payload,
    appID: config.appId,
    timestamp,
    serviceCode,
    signature: createTobySignatureWithConfig(config, timestamp, serviceCode),
  }

  return {
    appID: config.appId,
    responseJson: encryptTobyJsonWithConfig(responsePayload, config, 'TOBY_INBOUND_PRIVATE_KEY'),
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
  const { baseUrl } = getTobyOutboundConfig()
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
  return callTobyApi('/api/toby/member/query-by-phone', TOBY_SERVICE_CODES.memberLoginInfo, payload)
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
  return callTobyApi('/api/toby/subscribe/external/dealExSubscribe', TOBY_SERVICE_CODES.subscribe, payload)
}

export function syncTobyMemberSubCard(payload: TobyMemberSubCardRequest) {
  return callTobyApi<TobyMemberSubCardResponse>('/api/toby/member/sub-card', TOBY_SERVICE_CODES.memberSubCard, payload)
}

export function registerTobyMember(payload: TobyMemberRegisterRequest) {
  return callTobyApi('/api/toby/member/register', TOBY_SERVICE_CODES.memberRegister, payload)
}

export function queryTobyMemberPoints(payload: TobyMemberPointsRequest) {
  return callTobyApi('/api/toby/member/query-points', TOBY_SERVICE_CODES.memberPoints, payload)
}

/**
 * 业管 MEMBER-1005：主卡变更副卡 A豆（增加/扣减）。
 * 返回解密后的主副卡最新余额，供调用方更新展示缓存。
 */
export function changeTobyMemberPoints(payload: TobyMemberPointsChangeRequest) {
  return callTobyApi<TobyMemberPointsChangeResponse>(
    '/api/toby/member/points-change',
    TOBY_SERVICE_CODES.memberPointsChange,
    payload,
  )
}
