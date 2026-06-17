import { NextResponse } from 'next/server'
import packageJson from '../../../package.json'

export const revalidate = 3600

const RELEASES_URL = 'https://github.com/lawalletio/lawallet-nwc/releases'
const LATEST_RELEASE_API =
  'https://api.github.com/repos/lawalletio/lawallet-nwc/releases/latest'

type GithubRelease = {
  tag_name?: string
  html_url?: string
}

function parseVersion(version: string) {
  const match = version.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return match.slice(1).map(part => Number(part))
}

function isNewerVersion(latest: string, current: string) {
  const latestParts = parseVersion(latest)
  const currentParts = parseVersion(current)
  if (!latestParts || !currentParts) return false

  for (let i = 0; i < latestParts.length; i += 1) {
    if (latestParts[i] > currentParts[i]) return true
    if (latestParts[i] < currentParts[i]) return false
  }

  return false
}

export async function GET() {
  const currentVersion = packageJson.version

  try {
    const headers: HeadersInit = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'lawallet-nwc-version-check',
    }
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }

    const response = await fetch(LATEST_RELEASE_API, {
      headers,
      next: { revalidate },
    })

    if (!response.ok) {
      return NextResponse.json({
        currentVersion,
        latestVersion: null,
        releaseUrl: RELEASES_URL,
        updateAvailable: false,
      })
    }

    const release = (await response.json()) as GithubRelease
    const latestVersion = release.tag_name?.trim() || null

    return NextResponse.json({
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url || RELEASES_URL,
      updateAvailable: latestVersion
        ? isNewerVersion(latestVersion, currentVersion)
        : false,
    })
  } catch {
    return NextResponse.json({
      currentVersion,
      latestVersion: null,
      releaseUrl: RELEASES_URL,
      updateAvailable: false,
    })
  }
}
