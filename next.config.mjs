/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  },
  images: {
    unoptimized: true
  },
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/.well-known/lnurlp/:username',
        destination: '/api/lud16/:username'
      }
    ]
  }
}

export default nextConfig
