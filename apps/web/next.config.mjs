/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true
  },
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/.well-known/lnurlp/:username',
        destination: '/api/lud16/:username'
      },
      {
        source: '/.well-known/verify',
        destination: '/api/setup/verify'
      }
    ]
  }
}

export default nextConfig
