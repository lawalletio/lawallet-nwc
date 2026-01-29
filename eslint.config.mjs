import nextConfig from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  // Global ignores
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      'node_modules/**',
      'next-env.d.ts',
      'pnpm-lock.yaml'
    ]
  },

  // Extend Next.js config
  ...nextConfig,

  // Custom rules
  {
    rules: {
      '@next/next/no-img-element': 'off'
    }
  }
]

export default eslintConfig
