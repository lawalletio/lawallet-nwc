'use client'

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'lawallet-payment-sound:v1'
const BANANERO_SRC = '/sounds/sapeee-el-bananero.mp3'

export const PAYMENT_SOUND_IDS = ['chime', 'bananero', 'off'] as const

export type PaymentSoundId = (typeof PAYMENT_SOUND_IDS)[number]

export const DEFAULT_PAYMENT_SOUND: PaymentSoundId = 'off'

export const PAYMENT_SOUNDS: {
  id: PaymentSoundId
  label: string
  description: string
}[] = [
  { id: 'chime', label: 'Chime', description: 'Short tone' },
  {
    id: 'bananero',
    label: 'Sapeee',
    description: 'El Bananero'
  },
  { id: 'off', label: 'Off', description: 'No sound' }
]

const listeners = new Set<() => void>()
const playedCueIds = new Set<string>()

function parse(raw: string | null): PaymentSoundId {
  if (raw && (PAYMENT_SOUND_IDS as readonly string[]).includes(raw)) {
    return raw as PaymentSoundId
  }
  return DEFAULT_PAYMENT_SOUND
}

function read(): PaymentSoundId {
  if (typeof window === 'undefined') return DEFAULT_PAYMENT_SOUND
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_PAYMENT_SOUND
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (typeof window !== 'undefined' && listeners.size === 1) {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined' && listeners.size === 0) {
      window.removeEventListener('storage', onStorage)
    }
  }
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY) return
  for (const listener of listeners) listener()
}

export function getPaymentSound(): PaymentSoundId {
  return read()
}

export function setPaymentSound(id: PaymentSoundId) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // ignore quota / private-mode failures
    }
  }
  for (const listener of listeners) listener()
}

export function usePaymentSound(): PaymentSoundId {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_PAYMENT_SOUND)
}

/** Plays the chosen success sound. `off` is silent. */
export function playPaymentSuccessSound(id: PaymentSoundId = read()): void {
  if (typeof window === 'undefined') return
  if (id === 'off') return
  if (id === 'bananero') {
    playFile(BANANERO_SRC)
    return
  }
  playChime()
}

/** Plays once per payment cue so a remount does not repeat the sound. */
export function playPaymentCueSound(cueId: string): void {
  if (playedCueIds.has(cueId)) return
  playedCueIds.add(cueId)
  playPaymentSuccessSound()
}

function playFile(src: string) {
  if (typeof Audio === 'undefined') return
  const audio = new Audio(src)
  void audio.play().catch(() => {})
}

function playChime() {
  const Ctx =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Ctx) return
  const ctx = new Ctx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const now = ctx.currentTime
  osc.type = 'sine'
  osc.frequency.setValueAtTime(880, now)
  osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.34)
  osc.onended = () => {
    void ctx.close()
  }
}
