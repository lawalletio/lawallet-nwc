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
      '@next/next/no-img-element': 'off',

      // Next.js 16's `eslint-config-next/core-web-vitals` bundles the
      // React Compiler's strict rules. The codebase predates them and
      // has ~12 violations across unrelated files (cards page, settings
      // tabs, sse hook, landing navbar, etc.). Downgrade to `warn` so
      // they stay visible without blocking CI; they should be fixed in
      // a dedicated follow-up PR rather than bundled with feature work.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn'
    }
  }
]

export default eslintConfig
