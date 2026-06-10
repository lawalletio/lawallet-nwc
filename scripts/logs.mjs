#!/usr/bin/env node

// Read-only Pino JSON log filter — follow one request end-to-end or surface
// slow operations, from a log file or stdin.
//
//   pnpm dev:web 2>&1 | node scripts/logs.mjs --reqId=<id>
//   node scripts/logs.mjs --module=prisma --minMs=100 < server.log
//   node scripts/logs.mjs --span=nwc.pay_invoice < server.log
//
// Flags: --reqId=<id>  --module=<name>  --span=<name>  --minMs=<n>  --level=<n|name>
// Non-JSON lines pass through only with --all.

import { createInterface } from 'node:readline'

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.replace(/^--/, '').split('=')
      return [k, v ?? true]
    })
)

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 }
const minLevel = args.level
  ? (LEVELS[args.level] ?? parseInt(args.level, 10))
  : 0
const minMs = args.minMs ? parseInt(args.minMs, 10) : 0

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', line => {
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    if (args.all) console.log(line)
    return
  }

  if (args.reqId && entry.reqId !== args.reqId) return
  if (args.module && entry.module !== args.module) return
  if (args.span && entry.span !== args.span) return
  if (minLevel && (entry.level ?? 0) < minLevel) return
  if (minMs && (entry.durationMs ?? 0) < minMs) return

  const time = (entry.time ?? '').toString().replace(/^.*T/, '').replace(/Z$/, '')
  const level = Object.entries(LEVELS).find(([, v]) => v === entry.level)?.[0] ?? entry.level
  const parts = [
    time,
    String(level).toUpperCase().padEnd(5),
    entry.reqId ? `[${String(entry.reqId).slice(0, 8)}]` : '',
    entry.module ? `(${entry.module})` : '',
    entry.span ?? '',
    entry.msg ?? '',
    entry.durationMs !== undefined ? `${entry.durationMs}ms` : '',
    entry.res?.status ? `→ ${entry.res.status}` : ''
  ].filter(Boolean)

  console.log(parts.join(' '))
})
