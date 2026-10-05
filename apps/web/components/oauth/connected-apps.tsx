'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Bot, ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'
import { formatDateTime, formatRelativeTime } from '@/lib/client/format'
import { GRANTS_PATH, type OAuthGrantSummary } from '@/lib/client/oauth-api'
import { MCP_PATH } from '@/lib/oauth/constants'

export const MCP_DOCS_URL = 'https://docs.lawallet.io/docs/guides/mcp'

const noSubscription = () => () => {}

/**
 * Apps (AI assistants over MCP) the signed-in user has authorized, with
 * revoke, plus this instance's MCP URL so they can connect one. Mounted in
 * the wallet Security screen and the admin Account Settings page.
 */
export function ConnectedApps() {
  const { status } = useAuth()
  const { data, loading, error, refetch } = useApi<{
    grants: OAuthGrantSummary[]
  }>(status === 'authenticated' ? GRANTS_PATH : null)
  const revoke = useMutation<undefined, { success: true }>([GRANTS_PATH])
  const [target, setTarget] = useState<OAuthGrantSummary | null>(null)
  // Tokens are bound to the canonical MCP URL (from the `endpoint` setting),
  // which can differ from the host this page was opened on, and claude.ai
  // refuses a connector whose URL differs from it. Until the metadata answers,
  // or if it can't, fall back to this origin, read on the client only so
  // hydration never mismatches.
  const [canonicalUrl, setCanonicalUrl] = useState<string | null>(null)
  const originUrl = useSyncExternalStore(
    noSubscription,
    () => `${window.location.origin}${MCP_PATH}`,
    () => ''
  )
  const mcpUrl = canonicalUrl ?? originUrl
  const grants = data?.grants ?? []

  useEffect(() => {
    let cancelled = false
    void fetch('/.well-known/oauth-protected-resource')
      .then(response => (response.ok ? response.json() : null))
      .then(metadata => {
        if (!cancelled && typeof metadata?.resource === 'string') {
          setCanonicalUrl(metadata.resource)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRevoke(grant: OAuthGrantSummary) {
    try {
      await revoke.mutate(
        'del',
        `${GRANTS_PATH}/${encodeURIComponent(grant.id)}`
      )
      toast.success(`Access revoked for ${grant.clientName}`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not revoke access'
      )
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-2xl bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">
            MCP server URL
          </span>
          <a
            href={MCP_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Setup guide
            <ExternalLink className="size-3" />
          </a>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-background py-1 pl-3 pr-1">
          <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">
            {mcpUrl}
          </code>
          <CopyButton value={mcpUrl} label="MCP server URL" />
        </div>
        <p className="text-xs text-muted-foreground">
          Add it as a connector in Claude, ChatGPT or Cursor to let an AI
          assistant use your account. You choose what each app may do when you
          connect it.
        </p>
      </div>

      <div className="flex flex-col rounded-2xl bg-card">
        {error ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 px-4 py-4 text-sm text-destructive"
          >
            <span>Couldn&apos;t load connected apps: {error.message}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : loading && grants.length === 0 ? (
          <div className="flex min-h-14 items-center justify-center">
            <Spinner size={16} />
          </div>
        ) : grants.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No apps connected yet. To connect one, add the MCP server URL above
            as a connector in Claude or ChatGPT.
          </p>
        ) : (
          grants.map(grant => (
            <div
              key={grant.id}
              className="flex items-start justify-between gap-3 border-b border-border/40 px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
                  <Bot className="size-5" />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-base font-medium text-foreground">
                    <bdi>{grant.clientName}</bdi>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {grant.scopes.map(scope =>
                      scope === 'spend' ? (
                        <Badge
                          key={scope}
                          variant="outline"
                          className="border-destructive/50 text-destructive"
                        >
                          Spend
                          {grant.spendLimitSats !== null &&
                            ` · ${grant.spendLimitSats.toLocaleString()} sats/day`}
                        </Badge>
                      ) : (
                        <Badge
                          key={scope}
                          variant="secondary"
                          className="capitalize"
                        >
                          {scope}
                        </Badge>
                      )
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Connected <DateText value={grant.createdAt} />
                    {' · '}
                    {grant.lastUsedAt ? (
                      <>
                        Last used <DateText value={grant.lastUsedAt} />
                      </>
                    ) : (
                      'Not used yet'
                    )}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={() => setTarget(grant)}
                disabled={revoke.loading}
                aria-label={`Revoke access for ${grant.clientName}`}
              >
                Revoke
              </Button>
            </div>
          ))
        )}
      </div>

      <AlertDialog
        open={!!target}
        onOpenChange={open => {
          if (!open) setTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access?</AlertDialogTitle>
            <AlertDialogDescription>
              <bdi>{target?.clientName}</bdi> is disconnected right away and
              can&apos;t use your account until you connect it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (target) void handleRevoke(target)
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DateText({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatDateTime(value)}>
      {formatRelativeTime(value)}
    </time>
  )
}
