import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  flattenProviderModelsSeed,
  normalizeTobyProviderModel,
} from './provider-models-json.js'

describe('provider models json converter', () => {
  test('把 models.json 的 modelParams 拍平成 provider_models 可写入结构', () => {
    const rows = flattenProviderModelsSeed([
      {
        modelParams: [
          {
            modelCode: 'gpt-image-2',
            modelType: '1',
            modelName: '超能图片2',
            modelDesc: '文字渲染准确',
            modelProvider: 'comfly',
            useChannel: 'B,C',
            singleUnit: 'fix',
            paramsSchema: {
              resolution: ['2k'],
              aspect_ratio: [{ label: '1:1', value: '1:1' }],
            },
            paramsPricing: [
              { model: 'gpt-image-2', resolution: '2k', unit_price: 2 },
            ],
          },
        ],
      },
    ])

    assert.equal(rows[0].provider_code, 'comfly')
    assert.equal(rows[0].code, 'gpt-image-2')
    assert.equal(rows[0].name, '超能图片2')
    assert.equal(rows[0].description, '文字渲染准确')
    assert.equal(rows[0].module, 'image')
    assert.deepEqual(rows[0].params_schema, {
      resolution: ['2k'],
      aspect_ratio: [{ label: '1:1', value: '1:1' }],
    })
    assert.deepEqual(rows[0].params_pricing, [
      { model: 'gpt-image-2', resolution: '2k', unit_price: 2 },
    ])
    assert.equal(rows[0].resolution, '2k')
    assert.equal(rows[0].avatar, null)
    assert.equal(rows[0].is_active, true)
    assert.equal(
      (rows[0].category_references.image_to_image as { limits: { image: { max: number } } }).limits.image.max,
      6,
    )
  })

  test('把 Toby 旧版 params 数组转换成 params_pricing', () => {
    const row = normalizeTobyProviderModel({
      modelCode: 'seedance-2.0',
      modelType: '2',
      modelName: 'Seedance 2.0',
      modelDesc: '视频模型',
      modelProvider: 'volcengine',
      useChannel: 'B,C',
      singleUnit: 'second',
      materialRatio: '16:9,9:16',
      params: [
        { resolutionRatio: '720p', singleConsumeCount: 10 },
        { resolutionRatio: '1080p', singleConsumeCount: 20 },
      ],
    })

    assert.equal(row.provider_code, 'volcengine')
    assert.equal(row.code, 'seedance-2.0')
    assert.equal(row.module, 'video')
    assert.deepEqual(row.params_schema, {
      resolution: ['720p', '1080p'],
      aspect_ratio: ['16:9', '9:16'],
    })
    assert.deepEqual(row.params_pricing, [
      { model: 'seedance-2.0', resolution: '720p', unit_price: 10 },
      { model: 'seedance-2.0', resolution: '1080p', unit_price: 20 },
    ])
    assert.equal(
      (row.category_references.multimodal as { limits: { image: { max: number } } }).limits.image.max,
      9,
    )
    assert.equal(
      (row.category_references.frames as { limits: { image: { max: number } } }).limits.image.max,
      2,
    )
  })

  test('按模型 code 恢复旧 Seedream 图片参考限制', () => {
    const row = normalizeTobyProviderModel({
      modelCode: 'seedream-5.0-lite',
      modelType: '1',
      modelName: 'Seedream 5.0',
      modelDesc: '图片模型',
      modelProvider: 'volcengine',
      useChannel: 'B,C',
      singleUnit: 'fix',
      paramsSchema: { resolution: ['2k'], image_ref: '14' },
      paramsPricing: [],
    })

    assert.equal(
      (row.category_references.image_to_image as { limits: { image: { max: number } } }).limits.image.max,
      14,
    )
  })

  test('把业管中文供应商名称转换为现有 providers.code', () => {
    const row = normalizeTobyProviderModel({
      modelCode: 'ctyun-seedance-2.0',
      modelType: '2',
      modelName: '天翼云视频',
      modelDesc: '天翼云模型',
      modelProvider: '天翼云',
      useChannel: 'B,C',
      singleUnit: 'second',
      paramsSchema: {},
      paramsPricing: [],
    })

    assert.equal(row.provider_code, 'ctyun-edge')
  })

  test('把 models.json 中的 ctyun 供应商代码转换为 worker 使用的 ctyun-edge', () => {
    const row = normalizeTobyProviderModel({
      modelCode: 'ctyun-seedance-2.0',
      modelType: '2',
      modelName: '天翼云视频',
      modelDesc: '天翼云模型',
      modelProvider: 'ctyun',
      useChannel: 'B,C',
      singleUnit: 'second',
      paramsSchema: {},
      paramsPricing: [],
    })

    assert.equal(row.provider_code, 'ctyun-edge')
  })

  test('拒绝未知 modelType，避免静默写入错误模块', () => {
    assert.throws(
      () => normalizeTobyProviderModel({
        modelCode: 'unknown-model',
        modelType: '99',
        modelName: '未知模型',
        modelDesc: '未知',
        modelProvider: 'provider',
        useChannel: 'B,C',
        singleUnit: 'fix',
        paramsSchema: {},
        paramsPricing: [],
      }),
      /不支持的模型类型/,
    )
  })
})
