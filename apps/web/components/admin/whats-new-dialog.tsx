'use client'

import React from 'react'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  loadReleases,
  RELEASES_URL,
  type Release
} from '@/lib/client/changelog'
import packageJson from '../../package.json'

const APP_VERSION = packageJson.version
const HISTORY_SIZE = 5
/** Last version whose notes this browser has seen. */
const SEEN_KEY = 'lawallet-whats-new-seen'
/** Set by "Never display this again": stops the auto-open for good. */
const NEVER_KEY = 'lawallet-whats-new-never'

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked (private mode): the dialog just shows again next load.
  }
}

/** **bold**, `code`, [links](url) and #123 PR refs. */
function inline(text: string): React.ReactNode[] {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|#\d+\b)/)
    .map((part, i) => {
      if (i % 2 === 0) return part
      if (part.startsWith('**'))
        return <strong key={i}>{part.slice(2, -2)}</strong>
      if (part.startsWith('`'))
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 text-xs">
            {part.slice(1, -1)}
          </code>
        )
      const [, label, href] = part.match(/^\[(.+)\]\((.+)\)$/) ?? [
        part,
        part,
        `${RELEASES_URL}/pull/${part.slice(1)}`
      ]
      if (!/^https?:\/\//.test(href)) return label
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {label}
        </a>
      )
    })
}

function ReleaseNotes({ release }: { release: Release }) {
  return (
    <article className="space-y-3">
      {release.image && (
        <img
          src={release.image.src}
          alt={release.image.alt}
          loading="lazy"
          className="w-full rounded-lg border"
        />
      )}
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {release.body.split(/\n{2,}/).map((block, i) =>
          block.startsWith('- ') ? (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.split(/\n(?=- )/).map((item, j) => (
                <li key={j}>{inline(item.slice(2))}</li>
              ))}
            </ul>
          ) : (
            <p key={i}>{inline(block)}</p>
          )
        )}
      </div>
      <a
        href={release.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
      >
        Full release notes
        <ExternalLink className="size-3" />
      </a>
    </article>
  )
}

/**
 * Release notes dialog. Opens by itself once per new version (unless the user
 * picked "Never display this again"), and on demand — `open` — as a list of
 * the {@link HISTORY_SIZE} latest releases.
 */
export function WhatsNewDialog({
  open,
  onOpenChange,
  autoOpen
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  autoOpen: boolean
}) {
  const [latest, setLatest] = React.useState<Release | null>(null)
  const [history, setHistory] = React.useState<Release[] | null>(null)

  React.useEffect(() => {
    if (!autoOpen || readKey(NEVER_KEY) || readKey(SEEN_KEY) === APP_VERSION)
      return
    let cancelled = false
    loadReleases(APP_VERSION, 1).then(([release]) => {
      if (!cancelled && release?.version === APP_VERSION) setLatest(release)
    })
    return () => {
      cancelled = true
    }
  }, [autoOpen])

  React.useEffect(() => {
    if (open && !history)
      loadReleases(APP_VERSION, HISTORY_SIZE).then(setHistory)
  }, [open, history])

  const releases = open ? (history ?? []) : latest ? [latest] : []

  function close() {
    if (latest) {
      writeKey(SEEN_KEY, APP_VERSION)
      setLatest(null)
    }
    onOpenChange(false)
  }

  function neverShowAgain() {
    writeKey(NEVER_KEY, '1')
    close()
    toast('Release notes won’t open by themselves anymore', {
      description: 'Click the version in the sidebar to read them anytime.'
    })
  }

  return (
    <Dialog open={open || !!latest} onOpenChange={next => !next && close()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b p-6 pr-12">
          <DialogTitle>
            {open ? 'Release notes' : `What’s new in v${APP_VERSION}`}
          </DialogTitle>
          <DialogDescription>
            {open
              ? `The ${HISTORY_SIZE} latest LaWallet releases.`
              : 'LaWallet was updated. Here’s what changed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-6">
          {releases.map(release => (
            <section key={release.version} className="space-y-3">
              {open && (
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">v{release.version}</h3>
                  {release.version === APP_VERSION && (
                    <Badge variant="secondary">Installed</Badge>
                  )}
                  {release.date && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {release.date}
                    </span>
                  )}
                </div>
              )}
              <ReleaseNotes release={release} />
            </section>
          ))}
        </div>

        <DialogFooter className="items-center gap-2 border-t p-4 sm:justify-between sm:space-x-0">
          {!open && (
            <Button
              variant="link"
              size="sm"
              className="text-muted-foreground"
              onClick={neverShowAgain}
            >
              Never display this again
            </Button>
          )}
          <Button className="w-full sm:ml-auto sm:w-auto" onClick={close}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
