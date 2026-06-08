import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  creativeNavItems,
  managementNavItems,
  isNavItemActive,
} from './nav-config'

describe('creativeNavItems', () => {
  test('使用项目内命名映射参考页主导航', () => {
    assert.deepEqual(
      creativeNavItems.map((item) => item.label),
      ['灵感', '创作', 'Toby Studio', '灵动画布', '资产']
    )
    assert.equal(creativeNavItems.find((item) => item.label === '创作')?.href, '/generation?mode=image')
    assert.equal(creativeNavItems.find((item) => item.label === 'Toby Studio')?.href, '/toby-studio')
    assert.equal(creativeNavItems.find((item) => item.label === '灵动画布')?.href, '/canvas')
    assert.equal(creativeNavItems.find((item) => item.label === '资产')?.href, '/assets')
  })

  test('创作入口合并 AI 生图和 AI 视频', () => {
    const creation = creativeNavItems.find((item) => item.label === '创作')
    assert.equal(creation?.description, 'AI生图、生视频')
    assert.deepEqual(
      creation?.children?.map((item) => [item.label, item.href]),
      [
        ['AI 生图', '/generation?mode=image'],
        ['AI 视频', '/generation?mode=video'],
      ]
    )
  })
})

describe('managementNavItems', () => {
  test('左侧管理栏不重复承载创作主入口', () => {
    assert.deepEqual(
      managementNavItems.map((item) => item.label),
      ['团队管理', 'A豆管理', '管理后台', '设置', '操作手册']
    )
  })
})

describe('isNavItemActive', () => {
  test('根路径只在首页高亮灵感', () => {
    assert.equal(isNavItemActive('/', '/'), true)
    assert.equal(isNavItemActive('/', '/assets'), false)
  })

  test('带 query 的生成页只匹配相同 mode', () => {
    assert.equal(isNavItemActive('/generation?mode=image', '/generation?mode=image'), true)
    assert.equal(isNavItemActive('/generation?mode=image', '/generation?mode=video'), false)
    assert.equal(isNavItemActive('/generation?mode=video', '/generation?mode=video'), true)
    assert.equal(isNavItemActive('/generation?mode=video', '/generation?mode=image'), false)
  })

  test('无 query 的路径按路径段边界匹配', () => {
    assert.equal(isNavItemActive('/assets', '/assets-old'), false)
    assert.equal(isNavItemActive('/assets', '/assets/library'), true)
  })
})
