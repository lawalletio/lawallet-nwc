import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/docs/getting-started',
        destination: '/docs/deploy',
        permanent: true,
      },
      {
        source: '/docs/getting-started/vision',
        destination: '/docs/vision',
        permanent: true,
      },
      {
        source: '/docs/getting-started/onboarding',
        destination: '/docs/deploy/onboarding',
        permanent: true,
      },
      {
        source: '/docs/getting-started/docker',
        destination: '/docs/deploy/docker',
        permanent: true,
      },
      {
        source: '/docs/deploy/vision',
        destination: '/docs/vision',
        permanent: true,
      },
      {
        source: '/docs/jwt-authentication',
        destination: '/docs/guides/jwt-authentication',
        permanent: true,
      },
      {
        source: '/docs/roles-and-permissions',
        destination: '/docs/architecture/roles-and-permissions',
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
