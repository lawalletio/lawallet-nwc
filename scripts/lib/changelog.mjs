// Changelog PR-extraction — the raw material for docs/changelogs/v<x>.md.
//
// This is deliberately dependency-free and side-effect-free so scripts/release.mjs
// and the unit test can both import it. It parses the output of
//
//   git log <lastTag>..HEAD --pretty=format:%s%x09%b%x00
//
// into deduped changelog bullet lines, understanding BOTH merge styles this
// repo has used:
//
//   • merge-commit PRs (v0.x … v1.0.2): subject "Merge pull request #N from …"
//     with the PR title on the first line of the commit BODY.
//   • squash-merge PRs (v1.0.3+):       subject "Some title (#N)" and no merge
//     commit at all.
//
// The generator originally only understood the first style (`git log --merges`),
// so when the repo switched to squash-merges every v1.x changelog body came out
// empty: "- (no merged PRs found since the last tag)". Handling both styles is
// the fix; extractChangelogEntries also reports `prMentions` so the caller can
// hard-fail rather than silently ship an empty changelog if the merge style
// changes again.

// Parse a single commit (subject + joined body) into { pr, title } or null.
export function parsePrCommit(subject, body = '') {
  const s = String(subject).trim()

  // Classic GitHub merge commit — the PR title lives on the body's first line.
  const merge = s.match(/^Merge pull request #(\d+)\b/)
  if (merge) {
    const title = String(body).split('\n')[0].trim()
    return { pr: merge[1], title: title || '(no title)' }
  }

  // Squash / rebase-with-ref commit — GitHub appends "(#N)" to the subject.
  // Non-greedy title + end-anchored ref picks the LAST "(#N)" (so a reverted
  // "Foo (#12)" (#20) attributes to #20, the actual PR). Guard against other
  // "Merge …" subjects (e.g. branch-sync merges) that shouldn't be PR entries.
  if (!/^Merge\b/.test(s)) {
    const squash = s.match(/^(.*?)[ \t]*\(#(\d+)\)\s*$/)
    if (squash) {
      const title = squash[1].trim()
      return { pr: squash[2], title: title || '(no title)' }
    }
  }

  return null
}

// Parse the full `git log …%x09%b%x00` blob into changelog material.
// Returns:
//   entries     — [{ pr, title }] deduped by PR number, in git-log order
//   lines       — entries rendered as "- <title> (#<pr>)" bullets
//   prMentions  — how many commit subjects reference a PR number at all
//                 (excluding the release commit); used as an independent guard
//                 signal: prMentions > 0 with entries.length === 0 means the
//                 parser failed to recognize the current merge style.
export function extractChangelogEntries(rawLog) {
  const entries = []
  const seen = new Set()
  let prMentions = 0

  for (const record of String(rawLog).split('\0')) {
    const entry = record.trim()
    if (!entry) continue

    const [subject = '', ...bodyParts] = entry.split('\t')
    const s = subject.trim()

    // Independent "there is clearly a PR here" signal. Release commits
    // (chore(release): vX.Y.Z) never reference a PR — exclude them so a
    // PR-less release doesn't trip the guard.
    if (/#\d+/.test(s) && !/^chore\(release\)/.test(s)) prMentions++

    const parsed = parsePrCommit(s, bodyParts.join(' '))
    if (!parsed) continue
    if (seen.has(parsed.pr)) continue
    seen.add(parsed.pr)
    entries.push(parsed)
  }

  return {
    entries,
    lines: entries.map(e => `- ${e.title} (#${e.pr})`),
    prMentions
  }
}
