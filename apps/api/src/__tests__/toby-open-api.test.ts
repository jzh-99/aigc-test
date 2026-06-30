import '../lib/test-env.js'

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'

import {
  TOBY_SERVICE_CODES,
  type TobyServiceCode,
  buildTobyInboundResponse,
  buildTobyRequest,
  buildTobyResponse,
  decryptAndVerifyTobyInboundRequest,
  decryptAndVerifyTobyRequest,
  decryptAndVerifyTobyResponse,
  decryptTobyJson,
  deductTobyPoints,
  notifyTobyCreationResult,
  queryTobyMemberLoginInfo,
  queryTobyMemberPoints,
  queryTobyPointsChangeList,
  registerTobyMember,
  syncTobyMemberSubCard,
  syncTobySubscribe,
  type TobyEnvelope,
} from '../lib/toby-open-api.js'

type FetchRecord = {
  url: string
  body: TobyEnvelope
}

const TOBY_TEST_DATA = {
  memberQuery: {
    phone: '13111111111',
  },
  subscribe: {
    requestNo: 'req-1',
    exOrderNo: 'order-1',
    phone: '17714420972',
    channel: 2,
    source: 'BDQY',
    goodsId: 'goods-1',
    orderType: 1,
    payAmount: '9.90',
    status: 1,
  },
  pointsChangeList: {
    userId: 'D875BB9D3CCC4FA8A1F14569686739D9',
    changeType: '1', // 1:扣减 ；2:返还；3.赠送；4.过期；5.充值（支持逗号分割）
    pageNum: 1,
    pageSize: 20,
  },
  pointsChange: {
    userId: 'member-1',
    requestNo: 'points-change-1',
    source: 2,
    workNo: 'work-1',
    pointsNum: '3.00',
    remark: '测试扣减',
  },
  creationResultNotify: {
    userId: 'member-1',
    requestNo: 'creation-result-1',
    workNo: 'work-1',
    success: true,
    remark: '测试创作成功',
  },
  // 业管 MEMBER-1002（2026-06-29 契约更新）：移除 compName / channel。
  memberSubCard: {
    phone: '13111111111',
    userName: '13111111111',
    belongId: 'cfa57951-1824-4aca-8f71-77f48055f661',
    initialPointsNum: '1000.00',
  },
  memberRegister: {
    phone: '17714420972',
    userName: '张三',
    channel: '2',
  },
  memberPoints: {
    userId: 'D875BB9D3CCC4FA8A1F14569686739D9',
  },
  specificationConfig: {
    requestNo: 'spec-1',
    modelParams: {
      modelCode: 'model-image-1',
      modelType: '1',
      modelName: '图片模型',
      modelDesc: '测试模型',
      modelProvider: 'provider',
      modelStatus: 0,
      useChannel: 'B,C',
      singleUnit: 'fix',
      materialRatio: '3:4,16:9',
      params: [
        {
          resolutionRatio: '1k',
          singleConsumeCount: 10,
          inputConsumeCount: 1,
          ouputConsumeCount: 2,
        },
      ],
    },
  },
}

function readSentPayload(
  record: FetchRecord,
  serviceCode: TobyServiceCode,
) {
  return decryptAndVerifyTobyRequest<Record<string, unknown>>(record.body, serviceCode)
}

const originalFetch = globalThis.fetch

function printDecrypted(label: string, value: unknown) {
  console.info(`\n[${label}]\n${JSON.stringify(value, null, 2)}`)
}

function getTobyTestEnv() {
  const envNames = [
    'TOBY_OUTBOUND_BASE_URL',
    'TOBY_OUTBOUND_APP_ID',
    'TOBY_OUTBOUND_APP_SECRET',
    'TOBY_OUTBOUND_PRIVATE_KEY',
    'TOBY_INBOUND_APP_ID',
    'TOBY_INBOUND_APP_SECRET',
    'TOBY_INBOUND_PRIVATE_KEY',
  ] as const
  const env = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]?.trim() ?? '']),
  ) as Record<(typeof envNames)[number], string>
  const missing = envNames.filter((name) => !env[name])

  if (missing.length > 0) {
    throw new Error(`缺少 Toby 测试环境变量：${missing.join(', ')}，请先在仓库根目录 .env 中配置`)
  }

  return {
    ...env,
    TOBY_OUTBOUND_BASE_URL: env.TOBY_OUTBOUND_BASE_URL.replace(/\/$/, ''),
  }
}

function createSuccessFetch<T extends object>(
  serviceCode: TobyServiceCode,
  responsePayload: T,
  records: FetchRecord[],
) {
  globalThis.fetch = (async (input, init) => {
    records.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as TobyEnvelope,
    })

    return {
      ok: true,
      json: async () => ({
        code: '0000',
        message: 'success',
        data: buildTobyResponse(serviceCode, responsePayload),
      }),
    } as Response
  }) as typeof fetch
}

beforeEach(() => {
  getTobyTestEnv()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('Toby 业务管理平台开放接口协议', () => {
  test('会员信息查询真实调用业管 query-by-phone，并打印 responseJson 解密结果', async () => {
    const env = getTobyTestEnv()
    const { phone } = TOBY_TEST_DATA.memberQuery

    const requestPreview = buildTobyRequest(TOBY_SERVICE_CODES.memberLoginInfo, { phone })
    const requestPayload = decryptAndVerifyTobyRequest<Record<string, unknown>>(
      requestPreview,
      TOBY_SERVICE_CODES.memberLoginInfo,
    )
    printDecrypted('会员信息查询 requestJson 解密后（本地构造预览）', requestPayload)

    let result: Awaited<ReturnType<typeof queryTobyMemberLoginInfo>>
    try {
      result = await queryTobyMemberLoginInfo({ phone })
    } catch (err) {
      printDecrypted('会员信息查询真实请求失败', {
        url: `${env.TOBY_OUTBOUND_BASE_URL}/api/toby/member/query-by-phone`,
        phone,
        message: err instanceof Error ? err.message : String(err),
        cause: err instanceof Error && 'cause' in err ? err.cause : undefined,
      })
      throw err
    }

    printDecrypted('会员信息查询 原始响应', {
      code: result.code,
      message: result.message,
      data: result.data,
    })
    printDecrypted('会员信息查询 responseJson 解密后', result.decryptedData)

    assert.equal(requestPayload.phone, phone)
    assert.equal(requestPayload.serviceCode, 'MEMBER-1001')
    assert.equal(Object.hasOwn(requestPayload, 'userName'), false)
    assert.equal(result.code, '0000', `业管接口返回失败：${result.message}`)
    assert.ok(result.decryptedData, '业管成功响应应包含可解密的 responseJson')
    assert.equal(result.decryptedData?.appID, env.TOBY_OUTBOUND_APP_ID)
    assert.equal(result.decryptedData?.serviceCode, TOBY_SERVICE_CODES.memberLoginInfo)
    assert.ok(Array.isArray((result.decryptedData as { members?: unknown }).members))
  })

  test('订购同步按新版文档调用 /api/toby/subscribe/external/dealExSubscribe', async () => {
    const records: FetchRecord[] = []
    const env = getTobyTestEnv()
    createSuccessFetch(TOBY_SERVICE_CODES.subscribe, {
      requestNo: 'req-1',
      exOrderNo: 'order-1',
      orderNo: 'toby-order-1',
    }, records)

    await syncTobySubscribe(TOBY_TEST_DATA.subscribe)

    assert.equal(records[0].url, `${env.TOBY_OUTBOUND_BASE_URL}/api/toby/subscribe/external/dealExSubscribe`)
    const payload = readSentPayload(records[0], TOBY_SERVICE_CODES.subscribe)
    printDecrypted('订购同步 requestJson 解密后', payload)

    assert.equal(payload.source, 'BDQY')
    assert.equal(payload.serviceCode, TOBY_SERVICE_CODES.subscribe)
  })

  test('A豆流水查询按新版文档调用 change-list，并携带分页参数', async () => {
    const records: FetchRecord[] = []
    const env = getTobyTestEnv()
    createSuccessFetch(TOBY_SERVICE_CODES.pointsChangeQuery, {
      total: 0,
      pageNum: 1,
      pageSize: 20,
      records: [],
    }, records)

    const result = await queryTobyPointsChangeList(TOBY_TEST_DATA.pointsChangeList)

    assert.equal(records[0].url, `${env.TOBY_OUTBOUND_BASE_URL}/api/toby/points/external/change-list`)
    const payload = readSentPayload(records[0], TOBY_SERVICE_CODES.pointsChangeQuery)
    printDecrypted('A豆流水查询 requestJson 解密后', payload)
    printDecrypted('A豆流水查询 responseJson 解密后', result.decryptedData)

    assert.equal(payload.serviceCode, 'AIHUB_POINTS_CHANGE_QUERY')
    assert.equal(payload.userId, TOBY_TEST_DATA.pointsChangeList.userId)
    assert.equal(payload.changeType, TOBY_TEST_DATA.pointsChangeList.changeType)
    assert.equal(payload.pageNum, TOBY_TEST_DATA.pointsChangeList.pageNum)
    assert.equal(payload.pageSize, TOBY_TEST_DATA.pointsChangeList.pageSize)
  })

  test('A豆扣减按新版文档调用 change，并携带 source 必填字段', async () => {
    const records: FetchRecord[] = []
    const env = getTobyTestEnv()
    createSuccessFetch(TOBY_SERVICE_CODES.pointsChange, {
      requestNo: TOBY_TEST_DATA.pointsChange.requestNo,
      workNo: TOBY_TEST_DATA.pointsChange.workNo,
      status: 'DEDUCTED',
      balancePointsNum: '97.00',
      idempotent: false,
    }, records)

    const result = await deductTobyPoints(TOBY_TEST_DATA.pointsChange)

    assert.equal(records[0].url, `${env.TOBY_OUTBOUND_BASE_URL}/api/toby/points/external/change`)
    const payload = readSentPayload(records[0], TOBY_SERVICE_CODES.pointsChange)
    printDecrypted('A豆扣减 requestJson 解密后', payload)
    printDecrypted('A豆扣减 responseJson 解密后', result.decryptedData)

    assert.equal(payload.serviceCode, 'AIHUB_POINTS_CHANGE')
    assert.equal(payload.source, TOBY_TEST_DATA.pointsChange.source)
    assert.equal(payload.workNo, TOBY_TEST_DATA.pointsChange.workNo)
    assert.equal(payload.pointsNum, TOBY_TEST_DATA.pointsChange.pointsNum)
  })

  test('创作结果同步按新版文档调用 result-notify，并携带 success 结果', async () => {
    const records: FetchRecord[] = []
    const env = getTobyTestEnv()
    createSuccessFetch(TOBY_SERVICE_CODES.creationResultNotify, {
      requestNo: TOBY_TEST_DATA.creationResultNotify.requestNo,
      workNo: TOBY_TEST_DATA.creationResultNotify.workNo,
      status: 'SUCCESS',
      balancePointsNum: '97.00',
      idempotent: false,
    }, records)

    const result = await notifyTobyCreationResult(TOBY_TEST_DATA.creationResultNotify)

    assert.equal(records[0].url, `${env.TOBY_OUTBOUND_BASE_URL}/api/toby/points/external/result-notify`)
    const payload = readSentPayload(records[0], TOBY_SERVICE_CODES.creationResultNotify)
    printDecrypted('创作结果同步 requestJson 解密后', payload)
    printDecrypted('创作结果同步 responseJson 解密后', result.decryptedData)

    assert.equal(payload.serviceCode, 'AIHUB_CREATION_RESULT_NOTIFY')
    assert.equal(payload.success, TOBY_TEST_DATA.creationResultNotify.success)
    assert.equal(payload.workNo, TOBY_TEST_DATA.creationResultNotify.workNo)
  })

  test('会员副卡变动同步使用 MEMBER-1002 和 /api/toby/member/sub-card', async () => {
    const records: FetchRecord[] = []
    const env = getTobyTestEnv()
    createSuccessFetch(TOBY_SERVICE_CODES.memberSubCard, { userId: 'member-sub-1' }, records)

    const result = await syncTobyMemberSubCard(TOBY_TEST_DATA.memberSubCard)

    assert.equal(records[0].url, `${env.TOBY_OUTBOUND_BASE_URL}/api/toby/member/sub-card`)
    const payload = readSentPayload(records[0], TOBY_SERVICE_CODES.memberSubCard)
    printDecrypted('会员副卡变动 requestJson 解密后', payload)
    printDecrypted('会员副卡变动 responseJson 解密后', result.decryptedData)

    assert.equal(payload.serviceCode, 'MEMBER-1002')
    assert.equal(payload.phone, TOBY_TEST_DATA.memberSubCard.phone)
    assert.equal(payload.userName, TOBY_TEST_DATA.memberSubCard.userName)
    assert.equal(payload.belongId, TOBY_TEST_DATA.memberSubCard.belongId)
    assert.equal(payload.initialPointsNum, TOBY_TEST_DATA.memberSubCard.initialPointsNum)
    // 2026-06-29 契约更新：compName / channel 已从请求中移除，绝不可出现在解密后的报文里
    assert.equal(payload.compName, undefined, 'compName 已从 MEMBER-1002 契约移除')
    assert.equal(payload.channel, undefined, 'channel 已从 MEMBER-1002 契约移除')
  })

  test('个人会员注册使用 MEMBER-1003 和 /api/toby/member/register', async () => {
    const records: FetchRecord[] = []
    const env = getTobyTestEnv()
    createSuccessFetch(TOBY_SERVICE_CODES.memberRegister, { userId: 'member-1' }, records)

    const result = await registerTobyMember(TOBY_TEST_DATA.memberRegister)

    assert.equal(records[0].url, `${env.TOBY_OUTBOUND_BASE_URL}/api/toby/member/register`)
    const payload = readSentPayload(records[0], TOBY_SERVICE_CODES.memberRegister)
    printDecrypted('个人会员注册 requestJson 解密后', payload)
    printDecrypted('个人会员注册 responseJson 解密后', result.decryptedData)

    assert.equal(payload.serviceCode, 'MEMBER-1003')
    assert.equal(payload.userName, TOBY_TEST_DATA.memberRegister.userName)
    assert.equal((result.decryptedData as { userId: string }).userId, 'member-1')
  })

  test('会员A豆余额查询使用 MEMBER-1004 和 /api/toby/member/query-points', async () => {
    const records: FetchRecord[] = []
    const env = getTobyTestEnv()
    createSuccessFetch(TOBY_SERVICE_CODES.memberPoints, {
      pointsNum: '97.00',
      sumPointsNum: '100.00',
      status: 1,
    }, records)

    const result = await queryTobyMemberPoints(TOBY_TEST_DATA.memberPoints)

    assert.equal(records[0].url, `${env.TOBY_OUTBOUND_BASE_URL}/api/toby/member/query-points`)
    const payload = readSentPayload(records[0], TOBY_SERVICE_CODES.memberPoints)
    printDecrypted('会员A豆余额查询 requestJson 解密后', payload)
    printDecrypted('会员A豆余额查询 responseJson 解密后', result.decryptedData)

    assert.equal(payload.serviceCode, 'MEMBER-1004')
    assert.equal(payload.userId, TOBY_TEST_DATA.memberPoints.userId)
    assert.equal((result.decryptedData as { status: number }).status, 1)
  })

  test('模型规格同步使用 SPECIFICATION-CONFIG，并支持 modelParams.params 数组结构', () => {
    const envelope = buildTobyRequest(
      TOBY_SERVICE_CODES.specificationConfig,
      TOBY_TEST_DATA.specificationConfig,
    )

    const payload = decryptAndVerifyTobyRequest<{
      serviceCode: string
      modelParams: { modelStatus: number; params: Array<{ resolutionRatio: string }> }
    }>(envelope, TOBY_SERVICE_CODES.specificationConfig)
    printDecrypted('模型规格同步 requestJson 解密后', payload)

    assert.equal(payload.serviceCode, 'SPECIFICATION-CONFIG')
    assert.equal(payload.modelParams.modelStatus, TOBY_TEST_DATA.specificationConfig.modelParams.modelStatus)
    assert.equal(
      payload.modelParams.params[0].resolutionRatio,
      TOBY_TEST_DATA.specificationConfig.modelParams.params[0].resolutionRatio,
    )
  })

  test('模型规格入站回调用独立入站凭证解密验签并生成响应', () => {
    const envelope = buildTobyInboundResponse(
      TOBY_SERVICE_CODES.specificationConfig,
      TOBY_TEST_DATA.specificationConfig,
    )
    const inboundRequestEnvelope = {
      appID: envelope.appID,
      requestJson: envelope.responseJson,
    }

    const payload = decryptAndVerifyTobyInboundRequest<{
      serviceCode: string
      modelParams: { modelCode: string }
    }>(inboundRequestEnvelope, TOBY_SERVICE_CODES.specificationConfig)
    const response = buildTobyInboundResponse(TOBY_SERVICE_CODES.specificationConfig, {
      requestNo: 'spec-1',
      status: '0',
    })
    const env = getTobyTestEnv()

    assert.equal(payload.serviceCode, 'SPECIFICATION-CONFIG')
    assert.equal(payload.modelParams.modelCode, TOBY_TEST_DATA.specificationConfig.modelParams.modelCode)
    assert.equal(response.appID, env.TOBY_INBOUND_APP_ID)
  })

  test('响应验签失败时会拒绝错误 serviceCode，避免把其他接口响应混用', () => {
    const envelope = buildTobyResponse(TOBY_SERVICE_CODES.memberLoginInfo, { members: [] })

    assert.throws(
      () => decryptAndVerifyTobyResponse(envelope, TOBY_SERVICE_CODES.memberRegister),
      /serviceCode 不匹配/,
    )
  })

  test('加密报文外层 appID 不参与 requestJson 解密，但参与外层校验', () => {
    const envelope = buildTobyRequest(TOBY_SERVICE_CODES.memberRegister, TOBY_TEST_DATA.memberRegister)

    const innerPayload = decryptTobyJson<Record<string, unknown>>(envelope.requestJson ?? '')
    const env = getTobyTestEnv()
    printDecrypted('requestJson 解密后', innerPayload)

    assert.equal(envelope.appID, env.TOBY_OUTBOUND_APP_ID)
    assert.equal(innerPayload.appID, env.TOBY_OUTBOUND_APP_ID)
    assert.equal(innerPayload.serviceCode, TOBY_SERVICE_CODES.memberRegister)
  })
})
