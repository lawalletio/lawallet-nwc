'use client'

import React, { useState } from 'react'
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
import { useActivity, type ActivityCategory } from '@/lib/client/hooks/use-activity'

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

function formatTimestamp(ts: string) {
  const d = new Date(ts)
  return d.toLocaleString()
}

export default function ActivityPage() {
  const { data: logs } = useActivity()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 20

  const filtered = logs.filter((log) => {
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) {
      return false
    }
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize)

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
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
              className="pl-9"
            />
          </div>
          <Select disabled>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All category</SelectItem>
              <SelectItem value="USER">User</SelectItem>
              <SelectItem value="ADDRESS">Address</SelectItem>
              <SelectItem value="NWC">NWC</SelectItem>
              <SelectItem value="INVOICE">Invoice</SelectItem>
              <SelectItem value="CARD">Card</SelectItem>
              <SelectItem value="SERVER">Server</SelectItem>
            </SelectContent>
          </Select>
          <Select disabled>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-12">
                  No activity logs available
                </TableCell>
              </TableRow>
            ) : (
              paged.map((log) => (
                <TableRow
                  key={log.id}
                  className="border-l-[3px]"
                  style={{ borderLeftColor: CATEGORY_COLORS[log.category] }}
                >
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatTimestamp(log.timestamp)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={CATEGORY_TEXT_CLASSES[log.category]}>
                      {log.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md truncate">
                    {log.message}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
