'use client'

import React, { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Lock,
  MessageSquareText,
  Pencil,
  Play,
  Square,
  Undo2,
  UserX
} from 'lucide-react'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Label as ChartLabel,
  Pie,
  PieChart,
  XAxis,
  YAxis
} from 'recharts'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { useAuth } from '@/components/admin/auth-context'
import { StatCard } from '@/components/admin/stat-card'
import {
  PollFormDialog,
  type AdminPoll
} from '@/components/admin/polls/poll-form-dialog'
import { PollStatusBadge } from '@/components/admin/polls/poll-status-badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Role } from '@/lib/auth/permissions'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'
import {
  formatDateTime,
  formatRelativeTime,
  truncateNpub
} from '@/lib/client/format'
import type { PollResults } from '@/lib/polls'
import { cn } from '@/lib/utils'

const REFRESH_MS = 10_000

/**
 * Categorical slots (validated reference palette), assigned by option order
 * so a colour follows its option across every chart. Dark mode uses the same
 * hues stepped for the dark surface. Custom answers share a neutral grey.
 */
const LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948'
]
const DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#0ca30c',
  '#9085e9',
  '#e66767'
]
const PALETTE_CSS = `
.poll-viz{${LIGHT.map((c, i) => `--opt-${i}:${c};`).join('')}--opt-custom:#8a8a85}
.dark .poll-viz{${DARK.map((c, i) => `--opt-${i}:${c};`).join('')}--opt-custom:#7a7a75}
`

const CUSTOM = 'custom'
const CUSTOM_PREFIX = 'custom:'

export default function PollDashboardPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const { status, role } = useAuth()
  const allowed = status === 'authenticated' && role === Role.ADMIN

  useEffect(() => {
    if (status === 'authenticated' && !allowed) {
      router.replace('/admin/tools')
    }
  }, [status, allowed, router])

  const poll = useApi<AdminPoll>(allowed ? `/api/admin/polls/${id}` : null)
  const results = useApi<PollResults>(
    allowed ? `/api/admin/polls/${id}/results` : null
  )
  const { mutate } = useMutation<unknown, AdminPoll>(['/api/admin/polls'])
  const [editOpen, setEditOpen] = useState(false)

  // Live view: re-pull results (and the poll header) every 10 s.
  const { refetch: refetchResults } = results
  const { refetch: refetchPoll } = poll
  useEffect(() => {
    if (!allowed) return
    const timer = setInterval(() => {
      void refetchResults()
      void refetchPoll()
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [allowed, refetchResults, refetchPoll])

  const p = poll.data
  const r = results.data

  const colorOf = useMemo(() => {
    const index = new Map(p?.options.map((o, i) => [o.id, i]) ?? [])
    return (choice: string) => {
      const i = index.get(choice)
      return i === undefined
        ? 'var(--opt-custom)'
        : `var(--opt-${i % LIGHT.length})`
    }
  }, [p])
  const labelOf = useMemo(
    () => new Map(p?.options.map(o => [o.id, o.label]) ?? []),
    [p]
  )

  async function setStatus(next: AdminPoll['status']) {
    try {
      await mutate('patch', `/api/admin/polls/${id}`, { status: next })
      toast.success(next === 'OPEN' ? 'Poll is open' : 'Poll closed')
      await refetchPoll()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed')
    }
  }

  async function toggleDismiss(voter: { userId: string; dismissed?: boolean }) {
    const dismissed = !voter.dismissed
    try {
      await mutate('patch', `/api/admin/polls/${id}/voters/${voter.userId}`, {
        dismissed
      })
      toast.success(dismissed ? 'Vote dismissed' : 'Vote restored')
      await refetchResults()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed')
    }
  }

  const firstLoad = !p || !r
  const topPick =
    r && r.total > 0
      ? p?.type === 'RANKING'
        ? r.scores[0]?.label
        : r.firstChoice[0]?.label
      : undefined

  return (
    <div className="poll-viz flex flex-col">
      <style>{PALETTE_CSS}</style>
      <AdminTopbar
        title={p?.title ?? 'Poll'}
        subtitle={p?.description}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/tools/polls">
                <ArrowLeft className="size-4" /> Polls
              </Link>
            </Button>
            {p && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="size-4" /> Edit
                </Button>
                {p.status === 'OPEN' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus('CLOSED')}
                  >
                    <Square className="size-4" /> Close
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setStatus('OPEN')}>
                    <Play className="size-4" />
                    {p.status === 'DRAFT' ? 'Publish' : 'Reopen'}
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {p ? (
            <>
              <PollStatusBadge status={p.status} />
              <code>/api/polls/{p.slug}</code>
              <span>
                {p.type === 'RANKING' ? 'Ranking' : 'Single choice'} ·{' '}
                {p.options.length} options{p.allowCustom && ' + custom'}
              </span>
              {!p.updatable && (
                <span className="inline-flex items-center gap-1">
                  <Lock className="size-3" /> one-time
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1.5">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                Live · refreshes every 10 s
              </span>
            </>
          ) : (
            <Skeleton className="h-5 w-64" />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            title="Responses"
            value={r?.total}
            description="One per user"
            loading={firstLoad}
          />
          <StatCard
            title="Last vote"
            value={r?.updatedAt ? formatRelativeTime(r.updatedAt) : '—'}
            description={
              r?.updatedAt ? formatDateTime(r.updatedAt) : 'No votes yet'
            }
            loading={firstLoad}
          />
          <StatCard
            title="Top pick"
            value={topPick ?? '—'}
            description={
              p?.type === 'RANKING'
                ? 'Highest Borda score'
                : 'Most first choices'
            }
            loading={firstLoad}
          />
          <StatCard
            title="Custom answers"
            titleMobile="Custom"
            value={r?.custom.reduce((sum, c) => sum + c.count, 0)}
            description={r ? `${r.custom.length} distinct` : undefined}
            loading={firstLoad}
          />
        </div>

        <div
          className={cn(
            'grid gap-4',
            p?.type === 'RANKING' &&
              'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'
          )}
        >
          <FirstChoiceCard results={r} colorOf={colorOf} />
          {p?.type === 'RANKING' && (
            <ScoresCard results={r} colorOf={colorOf} />
          )}
        </div>

        {p?.allowCustom && <CustomCard results={r} />}

        <VotersCard
          results={r}
          colorOf={colorOf}
          labelOf={labelOf}
          onToggleDismiss={toggleDismiss}
        />
      </div>

      <PollFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        poll={p}
        onSaved={() => void refetchPoll()}
      />
    </div>
  )
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function FirstChoiceCard({
  results,
  colorOf
}: {
  results: PollResults | null
  colorOf: (choice: string) => string
}) {
  const slices = results?.firstChoice.filter(s => s.count > 0) ?? []
  const config = Object.fromEntries(
    (results?.firstChoice ?? []).map(s => [
      s.choice,
      { label: s.label, color: colorOf(s.choice) }
    ])
  ) satisfies ChartConfig

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">First choice</CardTitle>
        <CardDescription className="text-sm font-normal tracking-normal">
          What each voter put at the top.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!results ? (
          <Skeleton className="h-[240px]" />
        ) : slices.length === 0 ? (
          <EmptyChart>No votes yet.</EmptyChart>
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
            <ChartContainer
              config={config}
              className="aspect-square h-[220px] shrink-0"
            >
              <PieChart>
                <ChartTooltip
                  content={<ChartTooltipContent nameKey="choice" hideLabel />}
                />
                <Pie
                  data={slices}
                  dataKey="count"
                  nameKey="choice"
                  innerRadius={62}
                  isAnimationActive={false}
                  outerRadius={100}
                  stroke="var(--background)"
                  strokeWidth={2}
                >
                  {slices.map(s => (
                    <Cell key={s.choice} fill={colorOf(s.choice)} />
                  ))}
                  <ChartLabel
                    content={({ viewBox }) => {
                      if (!viewBox || !('cx' in viewBox)) return null
                      return (
                        <text
                          x={viewBox.cx}
                          y={viewBox.cy}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy ?? 0) - 6}
                            className="fill-foreground text-2xl font-semibold"
                          >
                            {results.total}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy ?? 0) + 16}
                            className="fill-muted-foreground text-xs"
                          >
                            votes
                          </tspan>
                        </text>
                      )
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>
            <ul className="flex w-full flex-col gap-2 text-sm">
              {results.firstChoice.map(s => (
                <li key={s.choice} className="flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: colorOf(s.choice) }}
                  />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {s.count}
                  </span>
                  <span className="w-10 text-right tabular-nums font-medium">
                    {Math.round((s.count / Math.max(results.total, 1)) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ScoresCard({
  results,
  colorOf
}: {
  results: PollResults | null
  colorOf: (choice: string) => string
}) {
  const config = { points: { label: 'Points' } } satisfies ChartConfig
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ranking score</CardTitle>
        <CardDescription className="text-sm font-normal tracking-normal">
          Borda count — with n entries, first place earns n points, last earns
          1; skipped options earn 0. Avg position (1 is best) counts only the
          responses that ranked it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!results ? (
          <Skeleton className="h-[240px]" />
        ) : results.total === 0 ? (
          <EmptyChart>No rankings yet.</EmptyChart>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto w-full"
            style={{ height: Math.max(200, results.scores.length * 48) }}
          >
            <BarChart
              data={results.scores}
              layout="vertical"
              margin={{ left: 0, right: 96, top: 4, bottom: 4 }}
              barCategoryGap={8}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                width={136}
                tick={({ x, y, payload, index }) => {
                  const skipped = results.scores[index]?.skipped ?? 0
                  return (
                    <text x={x} y={y} textAnchor="end" fontSize={12}>
                      <tspan
                        x={x}
                        dy={skipped ? -2 : 4}
                        className="fill-foreground"
                      >
                        {payload.value}
                      </tspan>
                      {skipped > 0 && (
                        <tspan
                          x={x}
                          dy={14}
                          fontSize={11}
                          className="fill-muted-foreground"
                        >
                          skipped by {skipped}
                        </tspan>
                      )}
                    </text>
                  )
                }}
              />
              <ChartTooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                content={
                  <ChartTooltipContent
                    hideIndicator
                    formatter={(value, _name, item) => (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">
                          {String(value)} points
                        </span>
                        <span className="text-muted-foreground">
                          avg position #{item.payload.avgPosition ?? '—'}
                        </span>
                        {item.payload.skipped > 0 && (
                          <span className="text-muted-foreground">
                            skipped by {item.payload.skipped}
                          </span>
                        )}
                      </div>
                    )}
                  />
                }
              />
              <Bar dataKey="points" radius={[0, 4, 4, 0]}>
                {results.scores.map(s => (
                  <Cell key={s.choice} fill={colorOf(s.choice)} />
                ))}
                <LabelList
                  dataKey="points"
                  position="right"
                  className="fill-foreground"
                  fontSize={12}
                  formatter={(value: unknown) => String(value)}
                />
                <LabelList
                  dataKey="avgPosition"
                  position="right"
                  offset={32}
                  className="fill-muted-foreground"
                  fontSize={11}
                  formatter={(value: unknown) =>
                    value == null ? '' : `avg #${value}`
                  }
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

function CustomCard({ results }: { results: PollResults | null }) {
  const max = Math.max(1, ...(results?.custom.map(c => c.count) ?? []))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText className="size-4" /> Custom answers
        </CardTitle>
        <CardDescription className="text-sm font-normal tracking-normal">
          Grouped case-insensitively.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!results ? (
          <Skeleton className="h-16" />
        ) : results.custom.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody wrote in their own answer yet.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {results.custom.map(c => (
              <li
                key={c.label}
                className="relative flex items-center justify-between overflow-hidden rounded-md border px-3 py-2 text-sm"
              >
                <span
                  className="absolute inset-y-0 left-0 bg-muted"
                  style={{ width: `${(c.count / max) * 100}%` }}
                />
                <span className="relative truncate">{c.label}</span>
                <span className="relative tabular-nums font-medium">
                  {c.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

type Voter = PollResults['voters'][number]

function VotersCard({
  results,
  colorOf,
  labelOf,
  onToggleDismiss
}: {
  results: PollResults | null
  colorOf: (choice: string) => string
  labelOf: Map<string, string>
  onToggleDismiss: (voter: Voter) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  async function toggle(voter: Voter) {
    setBusy(voter.userId)
    try {
      await onToggleDismiss(voter)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Voters</CardTitle>
        <CardDescription className="text-sm font-normal tracking-normal">
          {results
            ? `${results.total} counted${results.dismissed ? `, ${results.dismissed} dismissed` : ''} — newest first.`
            : ' '}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        {!results ? (
          <Skeleton className="mx-4 h-24 sm:mx-0" />
        ) : results.voters.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground sm:px-0">
            No responses yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Voter</TableHead>
                <TableHead>Choices</TableHead>
                <TableHead className="text-right">Updated</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.voters.map(v => (
                <TableRow
                  key={v.userId}
                  className={cn(v.dismissed && 'text-muted-foreground')}
                >
                  <TableCell className="min-w-[150px] max-w-[220px]">
                    <Link
                      href={`/admin/users/${v.userId}`}
                      className="flex flex-col hover:underline"
                    >
                      <span className="truncate font-medium">
                        {v.lightningAddress ?? truncateNpub(v.npub)}
                      </span>
                      {v.lightningAddress && (
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {truncateNpub(v.npub)}
                        </span>
                      )}
                      {v.dismissed && (
                        <span className="text-xs font-medium text-muted-foreground">
                          Dismissed · not counted
                        </span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ol
                      className={cn(
                        'flex min-w-[240px] flex-wrap gap-1.5',
                        v.dismissed && 'line-through opacity-50'
                      )}
                    >
                      {v.choices.map((choice, index) => {
                        const custom = choice.startsWith(CUSTOM_PREFIX)
                        return (
                          <li
                            key={choice}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-background py-0.5 pl-0.5 pr-2 text-xs"
                          >
                            <span
                              className="flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                              style={{
                                backgroundColor: colorOf(
                                  custom ? CUSTOM : choice
                                )
                              }}
                            >
                              {index + 1}
                            </span>
                            <span className={cn(custom && 'italic')}>
                              {custom
                                ? choice.slice(CUSTOM_PREFIX.length)
                                : (labelOf.get(choice) ?? choice)}
                            </span>
                          </li>
                        )
                      })}
                    </ol>
                  </TableCell>
                  <TableCell
                    className="whitespace-nowrap text-right text-xs text-muted-foreground"
                    title={formatDateTime(v.updatedAt)}
                  >
                    {formatRelativeTime(v.updatedAt)}
                  </TableCell>
                  <TableCell className="pl-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={busy === v.userId}
                      aria-label={v.dismissed ? 'Restore vote' : 'Dismiss vote'}
                      title={
                        v.dismissed
                          ? 'Restore — count this vote again'
                          : 'Dismiss — stop counting this vote'
                      }
                      onClick={() => void toggle(v)}
                    >
                      {v.dismissed ? (
                        <Undo2 className="size-4" />
                      ) : (
                        <UserX className="size-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
