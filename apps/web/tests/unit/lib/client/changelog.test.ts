import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  loadReleases,
  parseRelease
} from '@/lib/client/changelog'

describe('changelog', () => {
  it('parses summary, date and image', () => {
    const release = parseRelease(
      '2.8.0',
      '# v2.8.0\n\n![Art](https://x.test/a.png)\n\n## Release date\n\n2026-10-12\n\n## Summary\n\nFaster **wallet**.\n\n## Highlights\n\n- feat: ignored (#1)\n'
    )
    expect(release).toMatchObject({
      date: '2026-10-12',
      image: { alt: 'Art', src: 'https://x.test/a.png' },
      body: 'Faster **wallet**.',
      url: 'https://github.com/lawalletio/lawallet-nwc/releases/tag/v2.8.0'
    })
  })

  it('falls back to user-facing highlights when the summary is the scaffold placeholder', () => {
    const { body } = parseRelease(
      '2.7.2',
      '## Summary\n\n<!-- One-paragraph narrative. -->\n\n## Highlights\n\n- feat(wallet): open receive (#332)\n- chore: remove dead code (#305)\n- fix: drop ceiling (#311)\n'
    )
    expect(body).toBe('- Open receive (#332)\n- Drop ceiling (#311)')
  })

  it('orders semver numerically, not lexically', () => {
    expect(compareVersions('2.10.0', '2.9.1')).toBeGreaterThan(0)
    expect(compareVersions('v2.8.0', '2.8.0')).toBe(0)
  })

  it('loads the bundled changelogs newest-first, never past the installed version', async () => {
    const releases = await loadReleases('2.7.1', 5)
    expect(releases.map(r => r.version)).toEqual([
      '2.7.1',
      '2.7.0',
      '2.6.0',
      '2.5.1',
      '2.5.0'
    ])
    expect(releases[0].body).toMatch(/receipt/)
  })
})
