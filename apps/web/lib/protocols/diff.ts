import { PROTOCOL_KEYS, type ProtocolKey } from '@/lib/protocols/reference'

export type ProtocolFlags = Partial<Record<ProtocolKey, boolean | null>>

export interface ProtocolChange {
  key: ProtocolKey
  from: boolean | null
  to: boolean | null
}

export interface AddressProtocolOutcome {
  username: string
  changes: ProtocolChange[]
  /** Unknown became known, or unsupported became supported. */
  fixed: boolean
  error: string | null
}

export interface ProtocolScanTally {
  newlyValid: number
  newlyKnown: number
  lost: number
}

export interface ProtocolScanSummary {
  scanned: number
  failed: number
  changed: number
  fixed: number
  byProtocol: Record<ProtocolKey, ProtocolScanTally>
  fixedAddresses: AddressProtocolOutcome[]
  changedAddresses: AddressProtocolOutcome[]
  failedAddresses: AddressProtocolOutcome[]
}

function flag(value: boolean | null | undefined): boolean | null {
  return value === undefined ? null : value
}

export function protocolChanges(
  from: ProtocolFlags | undefined,
  to: ProtocolFlags | undefined
): ProtocolChange[] {
  return PROTOCOL_KEYS.flatMap(key => {
    const before = flag(from?.[key])
    const after = flag(to?.[key])
    if (before === after) return []
    return [{ key, from: before, to: after }]
  })
}

export function isNewlyKnown(change: ProtocolChange): boolean {
  return change.from === null && change.to !== null
}

export function isNewlyValid(change: ProtocolChange): boolean {
  return change.from !== true && change.to === true
}

export function isLost(change: ProtocolChange): boolean {
  return change.from === true && change.to !== true
}

export function isAddressFixed(changes: ProtocolChange[]): boolean {
  return changes.some(change => isNewlyKnown(change) || isNewlyValid(change))
}

function emptyTally(): ProtocolScanTally {
  return { newlyValid: 0, newlyKnown: 0, lost: 0 }
}

export function summarizeProtocolScan(
  results: Array<{
    username: string
    error: string | null
    previous?: { protocols: ProtocolFlags } | null
    protocols: { protocols: ProtocolFlags }
  }>
): ProtocolScanSummary {
  const byProtocol = Object.fromEntries(
    PROTOCOL_KEYS.map(key => [key, emptyTally()])
  ) as Record<ProtocolKey, ProtocolScanTally>

  const outcomes: AddressProtocolOutcome[] = results.map(result => {
    const changes = protocolChanges(
      result.previous?.protocols,
      result.protocols.protocols
    )
    for (const change of changes) {
      if (isNewlyValid(change)) byProtocol[change.key].newlyValid += 1
      if (isNewlyKnown(change)) byProtocol[change.key].newlyKnown += 1
      if (isLost(change)) byProtocol[change.key].lost += 1
    }
    return {
      username: result.username,
      changes,
      fixed: isAddressFixed(changes),
      error: result.error
    }
  })

  return {
    scanned: results.length,
    failed: results.filter(result => result.error).length,
    changed: outcomes.filter(outcome => outcome.changes.length > 0).length,
    fixed: outcomes.filter(outcome => outcome.fixed).length,
    byProtocol,
    fixedAddresses: outcomes.filter(outcome => outcome.fixed),
    changedAddresses: outcomes.filter(outcome => outcome.changes.length > 0),
    failedAddresses: outcomes.filter(outcome => outcome.error)
  }
}
