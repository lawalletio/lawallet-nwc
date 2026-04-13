import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/docs/vision',
        destination: '/docs/getting-started/vision',
        permanent: true,
      },
      {
        source: '/docs/onboarding',
        destination: '/docs/getting-started/onboarding',
        permanent: true,
      },
      {
        source: '/docs/docker',
        destination: '/docs/getting-started/docker',
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
