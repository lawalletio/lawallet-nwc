import { describe, it, expect } from 'vitest'

// The release changelog generator (scripts/release.mjs) lives at the repo root,
// outside this package. Its PR-extraction is factored into a pure helper so it
// can be regression-tested here — this suite runs in the `/check` gate.
//
// Regression context: the generator originally detected PRs via
// `git log --merges` + /^Merge pull request #N/. When the repo switched from
// merge-commit PRs (v0.x…v1.0.2) to squash-merges (v1.0.3+, subject "Title (#N)"
// with no merge commit), every v1.1.0–v1.4.0 changelog body came out as
// "- (no merged PRs found since the last tag)" despite real merged PRs.
import {
  extractChangelogEntries,
  parsePrCommit
} from '../../../../scripts/lib/changelog.mjs'

// Build a `git log --pretty=format:%s%x09%b%x00` blob from [subject, body] pairs:
// subject, TAB, body, then a NUL record separator.
const NUL = '\0'
const TAB = '\t'
const gitLog = (commits: [string, string?][]) =>
  commits
    .map(([subject, body = '']) => `${subject}${TAB}${body}${NUL}`)
    .join('')

describe('parsePrCommit', () => {
  it('parses a squash-merge subject "Title (#N)"', () => {
    expect(
      parsePrCommit('feat(wallet): expand settings and payment flows (#96)')
    ).toEqual({
      pr: '96',
      title: 'feat(wallet): expand settings and payment flows'
    })
  })

  it('parses a classic merge commit, taking the title from the body', () => {
    expect(
      parsePrCommit(
        'Merge pull request #34 from lawalletio/feat/card-key-lockdown',
        'feat(cards): NTAG424 key lockdown\n\nlonger body text'
      )
    ).toEqual({ pr: '34', title: 'feat(cards): NTAG424 key lockdown' })
  })

  it('attributes a reverted PR to the outer (last) #N', () => {
    expect(parsePrCommit('Revert "Add thing (#12)" (#20)')).toEqual({
      pr: '20',
      title: 'Revert "Add thing (#12)"'
    })
  })

  it('ignores branch-sync merge commits and release commits', () => {
    expect(
      parsePrCommit(
        "Merge branch 'main' of https://github.com/lawalletio/lawallet-nwc"
      )
    ).toBeNull()
    expect(parsePrCommit('chore(release): v1.1.0')).toBeNull()
    expect(parsePrCommit('a plain commit with no pr reference')).toBeNull()
  })
})

describe('extractChangelogEntries', () => {
  it('extracts squash-merge PRs (the v1.x style that regressed to empty)', () => {
    const log = gitLog([
      ['chore(release): v1.1.0'],
      ['feat(release): publish listener image (#75)'],
      ['fix(e2e): honor E2E_DATABASE_URL (#74)'],
      ['Add server-side Nostr profile cache (#60)']
    ])
    const { lines, entries, prMentions } = extractChangelogEntries(log)

    expect(entries).toHaveLength(3)
    expect(prMentions).toBe(3)
    expect(lines).toEqual([
      '- feat(release): publish listener image (#75)',
      '- fix(e2e): honor E2E_DATABASE_URL (#74)',
      '- Add server-side Nostr profile cache (#60)'
    ])
  })

  it('still extracts classic merge-commit PRs (v0.x style — no regression)', () => {
    const log = gitLog([
      ['chore(release): v0.12.0'],
      [
        'Merge pull request #34 from lawalletio/feat/lockdown',
        'feat(cards): NTAG424 key lockdown'
      ],
      ['feat(cards): NTAG424 key lockdown'], // the PR's own squashed-in commit, no #ref
      [
        'Merge pull request #33 from lawalletio/feat/lncurl',
        'feat(remote-wallets): LNCurl wallets'
      ]
    ])
    const { lines, entries } = extractChangelogEntries(log)

    expect(entries).toHaveLength(2)
    expect(lines).toEqual([
      '- feat(cards): NTAG424 key lockdown (#34)',
      '- feat(remote-wallets): LNCurl wallets (#33)'
    ])
  })

  it('handles a mixed range (one merge commit + one squash) and dedupes by PR number', () => {
    const log = gitLog([
      [
        'Merge pull request #47 from lawalletio/fix/nip98',
        'fix(web): split server-only validation'
      ],
      ['fix(ci): auto-publish Docker image (#46)'],
      // a stray commit that references #46 again must not double-count
      ['chore: follow-up tweak for (#46)']
    ])
    const { lines, entries } = extractChangelogEntries(log)

    expect(entries.map(e => e.pr)).toEqual(['47', '46'])
    expect(lines).toEqual([
      '- fix(web): split server-only validation (#47)',
      '- fix(ci): auto-publish Docker image (#46)'
    ])
  })

  it('ignores branch-sync merges and never counts them as PRs', () => {
    const log = gitLog([
      ["Merge branch 'main' of https://github.com/lawalletio/lawallet-nwc"],
      ['feat(users): let admins grant the ADMIN role (#79)']
    ])
    const { lines, prMentions } = extractChangelogEntries(log)

    expect(prMentions).toBe(1)
    expect(lines).toEqual([
      '- feat(users): let admins grant the ADMIN role (#79)'
    ])
  })

  // The guard in release.mjs keys off `prMentions > 0 && entries.length === 0`.
  // These two cases pin the two branches of that guard.
  it('GUARD: a range with merged PRs always yields entries (prMentions matched)', () => {
    const log = gitLog([
      ['chore(release): v1.3.0'],
      ['feat(admin): backup & restore (#85)'],
      ['feat(listener): clickable event rows (#86)'],
      ['chore(docs): allowlist backup routes (#87)']
    ])
    const { entries, prMentions } = extractChangelogEntries(log)

    // prMentions detects PRs; entries proves the parser kept up with them.
    // Equal-and-nonzero is exactly the healthy signal the guard checks for.
    expect(prMentions).toBeGreaterThan(0)
    expect(entries.length).toBe(prMentions)
    expect(entries.length).toBeGreaterThan(0)
  })

  it('GUARD: a genuinely PR-less range reports zero mentions (placeholder is legit)', () => {
    const log = gitLog([
      ['chore(release): v1.0.11'],
      ['hotfix: bump base image digest'],
      ["Merge branch 'main' of https://github.com/lawalletio/lawallet-nwc"]
    ])
    const { entries, prMentions } = extractChangelogEntries(log)

    // Nothing references a PR, so prMentions is 0 and the guard must NOT fire —
    // the "(no merged PRs found)" placeholder is correct here.
    expect(prMentions).toBe(0)
    expect(entries).toHaveLength(0)
  })

  it('returns empty output for an empty log', () => {
    expect(extractChangelogEntries('')).toEqual({
      entries: [],
      lines: [],
      prMentions: 0
    })
  })
})
