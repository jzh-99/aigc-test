import createMDX from '@next/mdx'
import remarkGfm from 'remark-gfm'

/** @type {import('next').NextConfig} */
const apiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:7001'
const storageHost = process.env.NEXT_PUBLIC_STORAGE_HOST ?? 'localhost'
const storagePort = process.env.NEXT_PUBLIC_STORAGE_PORT ?? '9000'

const nextConfig = {
  // standalone 模式：将所有依赖打包进 .next/standalone，减小镜像体积
  output: 'standalone',
  // 禁用构建时从 Google Fonts 下载字体（国内网络不可达）
  optimizeFonts: false,
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  transpilePackages: ['@aigc/types'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: storageHost,
        port: storagePort,
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
}

export default createMDX({
  options: {
    remarkPlugins: [remarkGfm],
  },
})(nextConfig)
