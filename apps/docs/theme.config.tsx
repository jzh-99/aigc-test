import React from 'react'
import { DocsThemeConfig } from 'nextra-theme-docs'

const config: DocsThemeConfig = {
  logo: <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>Toby.AI 企业版</span>,
  project: {
    link: '',
  },
  chat: {
    link: '',
  },
  docsRepositoryBase: 'https://github.com/placeholder/docs',
  footer: {
    text: '© 2025 Toby.AI 企业版 · AIGC创作平台 · 保留所有权利',
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="Toby.AI 企业版 AIGC创作平台 使用手册" />
      <title>Toby.AI 企业版 · 使用手册</title>
    </>
  ),
  sidebar: {
    titleComponent({ title }) {
      return <>{title}</>
    },
    defaultMenuCollapseLevel: 1,
  },
  toc: {
    title: '本页目录',
  },
  editLink: {
    text: null,
  },
  feedback: {
    content: null,
  },
  search: {
    placeholder: '搜索文档...',
  },
  darkMode: true,
}

export default config
