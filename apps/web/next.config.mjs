/** @type {import('next').NextConfig} */
const apiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:7001'
const storageHost = process.env.NEXT_PUBLIC_STORAGE_HOST ?? 'localhost'
const storagePort = process.env.NEXT_PUBLIC_STORAGE_PORT ?? '9000'

const nextConfig = {
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

export default nextConfig
