import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { DOTLOTTIE_WASM_SRC } from '@/lib/client/treasure-chest-cache'

// The player runtime is committed under public/ instead of fetched from a
// CDN. Fail as soon as the installed dotlottie-web moves past the copy.
describe('self-hosted dotlottie wasm', () => {
  it('matches the installed @lottiefiles/dotlottie-web build', () => {
    const fromReact = createRequire(
      require.resolve('@lottiefiles/dotlottie-react')
    )
    const webDir = dirname(
      fromReact.resolve('@lottiefiles/dotlottie-web')
    ).replace(/\/dist$/, '')
    const { version } = JSON.parse(
      readFileSync(join(webDir, 'package.json'), 'utf8')
    )

    expect(DOTLOTTIE_WASM_SRC).toBe(
      `/animations/dotlottie-player-${version}.wasm`
    )

    const sha = (p: string) =>
      createHash('sha256').update(readFileSync(p)).digest('hex')
    expect(sha(join(process.cwd(), 'public', DOTLOTTIE_WASM_SRC))).toBe(
      sha(join(webDir, 'dist', 'dotlottie-player.wasm'))
    )
  })
})
