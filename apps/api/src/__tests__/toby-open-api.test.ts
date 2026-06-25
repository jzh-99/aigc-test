import '../lib/test-env.js'

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'

import {
  TOBY_SERVICE_CODES,
  type TobyServiceCode,
  buildTobyRequest,
  buildTobyResponse,
  decryptAndVerifyTobyRequest,
  decryptAndVerifyTobyResponse,
  decryptTobyJson,
  queryTobyMemberLoginInfo,
  registerTobyMember,
  syncTobySubscribe,
  type TobyEnvelope,
} from '../lib/toby-open-api.js'

type FetchRecord = {
  url: string
  body: TobyEnvelope
}

const TOBY_TEST_DATA = {
  memberQuery: {
    phone: '17714420972',
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
  memberRegister: {
    phone: '17714420972',
    userName: '张三',
    channel: '2',
  },
  specificationConfig: {
    requestNo: 'spec-1',
    modelParams: {
      modelCode: 'model-image-1',
      modelType: '1',
      modelName: '图片模型',
      modelDesc: '测试模型',
      modelProvider: 'provider',
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

const originalFetch = globalThis.fetch

function printDecrypted(label: string, value: unknown) {
  console.info(`\n[${label}]\n${JSON.stringify(value, null, 2)}`)
}

function getTobyTestEnv() {
  const envNames = [
    'TOBY_BASE_URL',
    'TOBY_APP_ID',
    'TOBY_APP_SECRET',
    'TOBY_PRIVATE_KEY',
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
    TOBY_BASE_URL: env.TOBY_BASE_URL.replace(/\/$/, ''),
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
        url: `${env.TOBY_BASE_URL}/api/toby/member/query-by-phone`,
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
    assert.equal(result.decryptedData?.appID, env.TOBY_APP_ID)
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

    assert.equal(records[0].url, `${env.TOBY_BASE_URL}/api/toby/subscribe/external/dealExSubscribe`)
    const payload = decryptAndVerifyTobyRequest<Record<string, unknown>>(
      records[0].body,
      TOBY_SERVICE_CODES.subscribe,
    )
    printDecrypted('订购同步 requestJson 解密后', payload)

    assert.equal(payload.source, 'BDQY')
    assert.equal(payload.serviceCode, TOBY_SERVICE_CODES.subscribe)
  })

  test('个人会员注册使用 MEMBER-1003 和 /api/toby/member/register', async () => {
    const records: FetchRecord[] = []
    const env = getTobyTestEnv()
    createSuccessFetch(TOBY_SERVICE_CODES.memberRegister, { userId: 'member-1' }, records)

    const result = await registerTobyMember(TOBY_TEST_DATA.memberRegister)

    assert.equal(records[0].url, `${env.TOBY_BASE_URL}/api/toby/member/register`)
    const payload = decryptAndVerifyTobyRequest<Record<string, unknown>>(
      records[0].body,
      TOBY_SERVICE_CODES.memberRegister,
    )
    printDecrypted('个人会员注册 requestJson 解密后', payload)
    printDecrypted('个人会员注册 responseJson 解密后', result.decryptedData)

    assert.equal(payload.serviceCode, 'MEMBER-1003')
    assert.equal(payload.userName, TOBY_TEST_DATA.memberRegister.userName)
    assert.equal((result.decryptedData as { userId: string }).userId, 'member-1')
  })

  test('模型规格同步使用 SPECIFICATION-CONFIG，并支持 modelParams.params 数组结构', () => {
    const envelope = buildTobyRequest(
      TOBY_SERVICE_CODES.specificationConfig,
      TOBY_TEST_DATA.specificationConfig,
    )

    const payload = decryptAndVerifyTobyRequest<{
      serviceCode: string
      modelParams: { params: Array<{ resolutionRatio: string }> }
    }>(envelope, TOBY_SERVICE_CODES.specificationConfig)
    printDecrypted('模型规格同步 requestJson 解密后', payload)

    assert.equal(payload.serviceCode, 'SPECIFICATION-CONFIG')
    assert.equal(
      payload.modelParams.params[0].resolutionRatio,
      TOBY_TEST_DATA.specificationConfig.modelParams.params[0].resolutionRatio,
    )
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

    assert.equal(envelope.appID, env.TOBY_APP_ID)
    assert.equal(innerPayload.appID, env.TOBY_APP_ID)
    assert.equal(innerPayload.serviceCode, TOBY_SERVICE_CODES.memberRegister)
  })
})
