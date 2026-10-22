// Release notes for the "What's New" dialog. docs/changelogs/v*.md is bundled
// at build time (Turbopack `import.meta.glob` + the `?raw` rule in
// next.config.mjs), one lazy chunk per file. Bundling instead of asking GitHub
// keeps the notes working on offline self-hosted installs and pinned to the
// version actually running, never one it hasn't installed yet.
//
// No `import: 'default'`: production Turbopack mangles the text module's
// export name (`default` → `f`), so the picked export came back undefined and
// crashed the admin dashboard (Sentry LAWALLET-WEB-W). Reading `.default` off
// the whole module keeps the name observable, so it is not mangled.
const files = import.meta.glob<{ default: unknown }>(
  '../../../../docs/changelogs/v*.md',
  { query: '?raw' }
)

export const RELEASES_URL = 'https://github.com/lawalletio/lawallet-nwc'

export interface Release {
  version: string
  date: string | null
  image: { alt: string; src: string } | null
  /** Paragraphs and `- ` bullets with inline markdown. */
  body: string
  url: string
}

function parts(version: string): number[] {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1).map(Number) : [0, 0, 0]
}

export function compareVersions(a: string, b: string): number {
  const x = parts(a)
  const y = parts(b)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/** `## Heading` → section body, with the scaffold's `<!-- … -->` hints removed. */
function sections(md: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const chunk of md.split(/^## /m).slice(1)) {
    const [heading, ...rest] = chunk.split('\n')
    map.set(
      heading.trim(),
      rest
        .join('\n')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim()
    )
  }
  return map
}

export function parseRelease(version: string, md: string): Release {
  const s = sections(md)
  const image = md.match(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/)
  // Releases cut without a written summary only carry the scaffolded PR
  // list; show its user-facing entries instead of an empty dialog.
  const body =
    s.get('Summary') ||
    (s.get('Highlights') ?? '')
      .split('\n')
      .filter(line => /^- (feat|fix|perf)\b/.test(line))
      .map(line =>
        line.replace(
          /^- \w+(\([^)]*\))?!?: (\w)/,
          (_, _scope, first: string) => `- ${first.toUpperCase()}`
        )
      )
      .join('\n')

  return {
    version,
    date: s.get('Release date')?.split('\n')[0] || null,
    image: image ? { alt: image[1], src: image[2] } : null,
    body,
    url: `${RELEASES_URL}/releases/tag/v${version}`
  }
}

const available = Object.keys(files)
  .flatMap(path => {
    const match = path.match(/v(\d+\.\d+\.\d+)\.md$/)
    return match ? [{ version: match[1], path }] : []
  })
  .sort((a, b) => compareVersions(b.version, a.version))

/** Newest-first releases up to and including `upTo`. */
export async function loadReleases(
  upTo: string,
  limit: number
): Promise<Release[]> {
  const picked = available
    .filter(r => compareVersions(r.version, upTo) <= 0)
    .slice(0, limit)
  const releases = await Promise.all(
    picked.map(async r => {
      const md = (await files[r.path]()).default
      // One unreadable file drops its release, not the whole dialog.
      return typeof md === 'string' ? parseRelease(r.version, md) : null
    })
  )
  return releases.filter(r => r !== null)
}
