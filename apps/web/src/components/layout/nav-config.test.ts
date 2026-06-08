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
      ['灵感', 'AI 生图', 'AI 视频', 'Toby Studio', '灵动画布', '资产']
    )
    assert.equal(creativeNavItems.find((item) => item.label === 'Toby Studio')?.href, '/toby-studio')
    assert.equal(creativeNavItems.find((item) => item.label === '灵动画布')?.href, '/canvas')
    assert.equal(creativeNavItems.find((item) => item.label === '资产')?.href, '/assets')
  })

  test('AI 视频提供快速生成和视频工坊两个子入口', () => {
    const video = creativeNavItems.find((item) => item.label === 'AI 视频')
    assert.equal(video?.href, '/generation?mode=video')
    assert.deepEqual(
      video?.children?.map((item) => [item.label, item.href]),
      [
        ['快速生成', '/generation?mode=video'],
        ['视频工坊', '/video-studio'],
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

  test('忽略 query 后匹配生成页', () => {
    assert.equal(isNavItemActive('/generation?mode=image', '/generation'), true)
    assert.equal(isNavItemActive('/generation?mode=video', '/generation'), true)
  })
})
