'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useActivity,
  type ActivityCategory,
  type ActivityLevel,
  type ActivityLogView,
} from '@/lib/client/hooks/use-activity'

const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  USER: '#ef4444',
  ADDRESS: '#22c55e',
  NWC: '#eab308',
  INVOICE: '#eab308',
  CARD: '#ef4444',
  SERVER: '#ef4444',
}

const CATEGORY_TEXT_CLASSES: Record<ActivityCategory, string> = {
  USER: 'text-red-500',
  ADDRESS: 'text-green-500',
  NWC: 'text-yellow-500',
  INVOICE: 'text-yellow-500',
  CARD: 'text-red-500',
  SERVER: 'text-red-500',
}

const LEVEL_CLASSES: Record<ActivityLevel, string> = {
  INFO: 'text-muted-foreground',
  WARN: 'text-yellow-500',
  ERROR: 'text-red-500',
}

const ALL = 'all' as const

function formatTimestamp(ts: string) {
  const d = new Date(ts)
  return d.toLocaleString()
}

export default function ActivityPage() {
  const [categoryFilter, setCategoryFilter] = useState<ActivityCategory | typeof ALL>(ALL)
  const [levelFilter, setLevelFilter] = useState<ActivityLevel | typeof ALL>(ALL)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState<ActivityLogView | null>(null)

  // Debounce the search input so we don't hammer the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const filters = useMemo(
    () => ({
      category: categoryFilter === ALL ? undefined : categoryFilter,
      level: levelFilter === ALL ? undefined : levelFilter,
      q: debouncedSearch || undefined,
    }),
    [categoryFilter, levelFilter, debouncedSearch]
  )

  const { data: logs, loading, error, hasMore, loadMore } = useActivity(filters)

  return (
    <div className="flex flex-col">
      <AdminTopbar title="Activity" />

      <div className="p-6 flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold">Logs</h2>
          <p className="text-sm text-muted-foreground">
            View system activity and event logs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter(v as ActivityCategory | typeof ALL)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All category</SelectItem>
              <SelectItem value="USER">User</SelectItem>
              <SelectItem value="ADDRESS">Address</SelectItem>
              <SelectItem value="NWC">NWC</SelectItem>
              <SelectItem value="INVOICE">Invoice</SelectItem>
              <SelectItem value="CARD">Card</SelectItem>
              <SelectItem value="SERVER">Server</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={levelFilter}
            onValueChange={(v) => setLevelFilter(v as ActivityLevel | typeof ALL)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All status</SelectItem>
              <SelectItem value="INFO">Info</SelectItem>
              <SelectItem value="WARN">Warn</SelectItem>
              <SelectItem value="ERROR">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="text-sm text-red-500">
            Failed to load activity: {error.message}
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                  {loading ? 'Loading...' : 'No activity logs available'}
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow
                  key={log.id}
                  className="border-l-[3px] cursor-pointer hover:bg-muted/40"
                  style={{ borderLeftColor: CATEGORY_COLORS[log.category] }}
                  onClick={() => setSelected(log)}
                >
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatTimestamp(log.timestamp)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={CATEGORY_TEXT_CLASSES[log.category]}>
                      {log.category}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className={LEVEL_CLASSES[log.level]}>{log.level}</span>
                  </TableCell>
                  <TableCell className="max-w-md truncate">
                    {log.message}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore || loading}
            onClick={() => loadMore()}
          >
            {loading ? 'Loading...' : hasMore ? 'Load older' : 'No more entries'}
          </Button>
        </div>
      </div>

      <ActivityDetailsDialog
        log={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  )
}

function ActivityDetailsDialog({
  log,
  onOpenChange,
}: {
  log: ActivityLogView | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={!!log} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-4 sm:p-6 gap-3 sm:gap-4">
        {log && (
          <>
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                <Badge variant="outline" className={CATEGORY_TEXT_CLASSES[log.category]}>
                  {log.category}
                </Badge>
                <span className={LEVEL_CLASSES[log.level]}>{log.level}</span>
                <span className="font-mono text-xs text-muted-foreground break-all">
                  {log.event}
                </span>
              </DialogTitle>
              <DialogDescription className="pt-2 text-foreground text-left">
                {log.message}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto -mx-4 sm:-mx-6 px-4 sm:px-6 space-y-4">
              <dl className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-x-4 gap-y-1 sm:gap-y-2 text-sm">
                <dt className="text-muted-foreground">Time</dt>
                <dd>{new Date(log.timestamp).toLocaleString()}</dd>

                {log.category === 'INVOICE' && typeof (log.metadata as { amountSats?: unknown })?.amountSats === 'number' && (
                  <>
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd>
                      {(log.metadata as { amountSats: number }).amountSats.toLocaleString()} sats
                    </dd>
                  </>
                )}

                <dt className="text-muted-foreground">Log ID</dt>
                <dd className="font-mono text-xs break-all">{log.id}</dd>

                {log.reqId && (
                  <>
                    <dt className="text-muted-foreground">Request ID</dt>
                    <dd className="font-mono text-xs break-all" title="Matches reqId in Pino logs">
                      {log.reqId}
                    </dd>
                  </>
                )}

                {log.userId && (
                  <>
                    <dt className="text-muted-foreground">User ID</dt>
                    <dd className="font-mono text-xs break-all">
                      <Link
                        href={`/admin/users/${log.userId}`}
                        className="text-primary underline-offset-2 hover:underline"
                        onClick={() => onOpenChange(false)}
                      >
                        {log.userId}
                      </Link>
                    </dd>
                  </>
                )}
              </dl>

              {log.metadata && Object.keys(log.metadata).length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Metadata</div>
                  <pre className="rounded-md border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                    {JSON.stringify(log.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
