#!/usr/bin/env node

// Release version bump + changelog scaffold.
//
//   node scripts/release.mjs --bump patch|minor|major [--dry]
//
// What it does (the release.yml workflow drives this in CI):
//   1. Resolves the base version: the HIGHER of the root package.json
//      version and the latest v* git tag (they have drifted before — e.g.
//      tag v0.10.1 vs package.json 0.10.0).
//   2. Bumps the lockstep packages: root, @lawallet-nwc/web, @lawallet-nwc/cli.
//      (shared/openapi/sdk are versioned independently and untouched.)
//   3. Scaffolds docs/changelogs/v<new>.md in the house format, pre-filled
//      with the merged PRs since the last tag as raw material for the
//      narrative Summary/Highlights sections.
//
// --dry prints the plan without writing anything.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractChangelogEntries } from './lib/changelog.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const bumpIndex = args.indexOf('--bump')
const bump = bumpIndex >= 0 ? args[bumpIndex + 1] : null

if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('Usage: node scripts/release.mjs --bump patch|minor|major [--dry]')
  process.exit(1)
}

const LOCKSTEP_PACKAGES = ['package.json', 'apps/web/package.json', 'apps/cli/package.json']

const git = cmd => execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim()

function parseSemver(v) {
  const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

// ── 1. Resolve base version (max of package.json and latest tag) ──────────

const pkgVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version

const tags = git('tag -l "v*"')
  .split('\n')
  .map(t => parseSemver(t))
  .filter(Boolean)
  .sort(compareSemver)

const latestTag = tags.at(-1) ?? null
const pkgSemver = parseSemver(pkgVersion)

if (!pkgSemver) {
  console.error(`Root package.json version "${pkgVersion}" is not x.y.z`)
  process.exit(1)
}

let base = pkgSemver
if (latestTag && compareSemver(latestTag, pkgSemver) > 0) {
  console.warn(
    `! package.json (${pkgVersion}) is behind the latest tag ` +
      `(v${latestTag.join('.')}) — using the tag as the base.`
  )
  base = latestTag
}

const next = [...base]
if (bump === 'major') {
  next[0]++
  next[1] = 0
  next[2] = 0
} else if (bump === 'minor') {
  next[1]++
  next[2] = 0
} else {
  next[2]++
}
const nextVersion = next.join('.')

// ── 2. Collect merged PRs since the last tag (changelog raw material) ─────

const lastTagName = latestTag ? `v${latestTag.join('.')}` : null
let prLines = []
if (lastTagName) {
  // Walk EVERY commit since the last tag (not just --merges): this repo used
  // merge-commit PRs through v1.0.2 and squash-merge PRs since, and only the
  // former produce merge commits. extractChangelogEntries understands both.
  const log = git(`log ${lastTagName}..HEAD --pretty=format:%s%x09%b%x00`)
  const { lines, entries, prMentions } = extractChangelogEntries(log)

  // Guard: if commits in the range clearly reference PRs (#NNN) but none were
  // parsed into entries, the merge/commit style has changed out from under the
  // parser — hard-fail rather than silently scaffold an empty changelog (the
  // exact regression that emptied every v1.1.0–v1.4.0 changelog body).
  if (prMentions > 0 && entries.length === 0) {
    console.error(
      `✗ ${prMentions} commit(s) since ${lastTagName} reference a PR (#NNN) but none ` +
        `were parsed into changelog entries — the merge/commit style may have changed. ` +
        `Fix scripts/lib/changelog.mjs before releasing.`
    )
    process.exit(1)
  }

  prLines = lines
}

// ── 3. Report / apply ──────────────────────────────────────────────────────

console.log(`Release: ${bump} bump → v${nextVersion}`)
console.log(`Base: package.json ${pkgVersion}` + (lastTagName ? `, latest tag ${lastTagName}` : ''))
console.log(`Lockstep bumps: ${LOCKSTEP_PACKAGES.join(', ')}`)
console.log(`Merged PRs since ${lastTagName ?? 'the beginning'}: ${prLines.length}`)

if (dry) {
  console.log('\n--dry: no files written. Changelog preview:\n')
  console.log(prLines.join('\n') || '(none)')
  process.exit(0)
}

for (const rel of LOCKSTEP_PACKAGES) {
  const p = path.join(root, rel)
  const pkg = JSON.parse(readFileSync(p, 'utf8'))
  pkg.version = nextVersion
  writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`bumped ${rel}`)
}

const changelogPath = path.join(root, 'docs', 'changelogs', `v${nextVersion}.md`)
if (!existsSync(changelogPath)) {
  const today = new Date().toISOString().slice(0, 10)
  writeFileSync(
    changelogPath,
    `# v${nextVersion}

## Release date

${today}

## Summary

<!-- One-paragraph narrative of the release. -->

## Highlights

<!-- Group the PRs below into themed sections; see v0.10.0.md for the format. -->

${prLines.join('\n') || '- (no merged PRs found since the last tag)'}
`
  )
  console.log(`scaffolded docs/changelogs/v${nextVersion}.md`)
}

// Machine-readable output for the workflow.
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `version=${nextVersion}\n`, { flag: 'a' })
}
