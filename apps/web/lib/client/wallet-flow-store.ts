'use client'

import { useSyncExternalStore } from 'react'
import type { ParsedDestination } from './nwc/parse-destination'

/**
 * State for the multi-step send/receive flows. Kept in a module-level store
 * (not URL params) so the `amount` page can read `recipient` without hoisting
 * every field into a query string. A full page refresh wipes state on
 * purpose — replaying a stale bolt11 or recipient is a footgun.
 */

export interface ResolvedRecipient {
  /** Original input the user typed. */
  raw: string
  destination: ParsedDestination
  /** Resolved LUD-16 profile (avatar, handle) if the recipient is a lightning address. */
  profile?: {
    name?: string
    image?: string | null
    description?: string | null
  }
}

export interface SendFlowState {
  recipient: ResolvedRecipient | null
  amountSats: number | null
  comment: string
  result: {
    preimage: string
    feesPaidSats: number
    amountSats: number
    recipient: string
  } | null
  error: string | null
}

export interface ReceiveFlowState {
  amountSats: number | null
  description: string
  invoice: {
    bolt11: string
    paymentHash: string
    amountSats: number
    description: string
    expiresAt: number | null
  } | null
  settledPreimage: string | null
  error: string | null
}

interface WalletFlowState {
  send: SendFlowState
  receive: ReceiveFlowState
}

const INITIAL_STATE: WalletFlowState = {
  send: {
    recipient: null,
    amountSats: null,
    comment: '',
    result: null,
    error: null,
  },
  receive: {
    amountSats: null,
    description: '',
    invoice: null,
    settledPreimage: null,
    error: null,
  },
}

let state: WalletFlowState = INITIAL_STATE
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): WalletFlowState {
  return state
}

/**
 * SSR note: the module-level `state` is the same on server and client, and
 * React tolerates a shared server snapshot provided the value is stable.
 * Pages that read flow state are all client components so this runs on the
 * client only in practice.
 */
function getServerSnapshot(): WalletFlowState {
  return INITIAL_STATE
}

export function useSendFlow(): SendFlowState {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().send,
    () => getServerSnapshot().send,
  )
}

export function useReceiveFlow(): ReceiveFlowState {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().receive,
    () => getServerSnapshot().receive,
  )
}

export const sendActions = {
  setRecipient(recipient: ResolvedRecipient | null) {
    state = {
      ...state,
      send: { ...state.send, recipient, error: null },
    }
    emit()
  },
  setAmount(amountSats: number | null) {
    state = { ...state, send: { ...state.send, amountSats, error: null } }
    emit()
  },
  setComment(comment: string) {
    state = { ...state, send: { ...state.send, comment } }
    emit()
  },
  setResult(result: SendFlowState['result']) {
    state = { ...state, send: { ...state.send, result, error: null } }
    emit()
  },
  setError(error: string | null) {
    state = { ...state, send: { ...state.send, error } }
    emit()
  },
  reset() {
    state = { ...state, send: INITIAL_STATE.send }
    emit()
  },
}

export const receiveActions = {
  setAmount(amountSats: number | null) {
    state = {
      ...state,
      receive: { ...state.receive, amountSats, error: null },
    }
    emit()
  },
  setDescription(description: string) {
    state = { ...state, receive: { ...state.receive, description } }
    emit()
  },
  setInvoice(invoice: ReceiveFlowState['invoice']) {
    state = { ...state, receive: { ...state.receive, invoice, error: null } }
    emit()
  },
  markSettled(preimage: string) {
    state = {
      ...state,
      receive: { ...state.receive, settledPreimage: preimage },
    }
    emit()
  },
  setError(error: string | null) {
    state = { ...state, receive: { ...state.receive, error } }
    emit()
  },
  reset() {
    state = { ...state, receive: INITIAL_STATE.receive }
    emit()
  },
}

export function resetAllFlows() {
  state = INITIAL_STATE
  emit()
}
