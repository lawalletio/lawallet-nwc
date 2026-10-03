/**
 * Synthesized LUD-03 claim sting: a lightning crack, a chest impact,
 * a rising spray of coins, then a short major chord. No audio file —
 * the whole cue is Web Audio so it ships with the app and starts on the
 * same gesture that submits the withdraw.
 */

type Stoppable = OscillatorNode | AudioBufferSourceNode

let ctx: AudioContext | null = null
let master: GainNode | null = null
let sources: Stoppable[] = []
let muted = false

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Ctor) return null
  if (!ctx) {
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = 0.2
    master.connect(ctx.destination)
  }
  return ctx
}

/** Call from the withdraw click so the audio device is allowed to speak. */
export function unlockClaimSound(): void {
  try {
    const audio = context()
    if (audio && audio.state === 'suspended') void audio.resume()
  } catch {
    // Missing audio hardware should never block a claim.
  }
}

export function claimSoundMuted(): boolean {
  return muted
}

export function setClaimSoundMuted(next: boolean): void {
  muted = next
  if (next) stopClaimSound()
}

export function stopClaimSound(): void {
  for (const source of sources) {
    try {
      source.stop()
    } catch {
      // Already stopped.
    }
  }
  sources = []
}

/** Audible length of {@link chord}, from its start to the last partial dying out. */
const CHORD_TAIL_SEC = 0.64
/** Frame where the chest lid opens in treasure-chest.lottie (300 frames). */
const LID_FRAME = 56
const LOTTIE_FRAMES = 300

/**
 * Plays the sting across `durationSec`, the Lottie's own duration.
 * The crack is the opening burst, the impact is the lid, coins spill
 * until the resolving chord, and that chord ends on the last frame.
 */
export function playClaimCelebration(reduced = false, durationSec = 5): void {
  try {
    const audio = context()
    if (!audio || !master || muted) return
    if (audio.state === 'suspended') void audio.resume()
    stopClaimSound()
    const now = audio.currentTime + 0.02
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(0.2, now)
    if (reduced) {
      chord(audio, master, now)
      return
    }
    const span = Math.max(CHORD_TAIL_SEC + 0.4, durationSec)
    const lid = now + (LID_FRAME / LOTTIE_FRAMES) * span
    const chordAt = now + span - CHORD_TAIL_SEC
    crack(audio, master, now)
    impact(audio, master, lid)
    const coinStart = lid + 0.06
    const coinEnd = chordAt - 0.1
    const coins = 18
    for (let index = 0; index < coins; index++) {
      const t = index / (coins - 1)
      const eased = t
      coin(audio, master, coinStart + (coinEnd - coinStart) * eased, 580 + index * 36)
    }
    chord(audio, master, chordAt)
  } catch {
    // Autoplay restrictions or a closed context — the animation still runs.
  }
}

function track(source: Stoppable): void {
  sources.push(source)
  source.addEventListener('ended', () => {
    sources = sources.filter(item => item !== source)
  })
}

function tone(
  audio: AudioContext,
  output: GainNode,
  start: number,
  freq: number,
  dur: number,
  gain: number,
  type: OscillatorType,
  slideTo?: number
): void {
  const osc = audio.createOscillator()
  const amp = audio.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), start + dur)
  amp.gain.setValueAtTime(gain, start)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(amp)
  amp.connect(output)
  osc.start(start)
  osc.stop(start + dur + 0.02)
  track(osc)
}

function noiseBurst(
  audio: AudioContext,
  output: GainNode,
  start: number,
  dur: number,
  gain: number,
  frequency: number
): void {
  const length = Math.max(1, Math.floor(audio.sampleRate * dur))
  const buffer = audio.createBuffer(1, length, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  const source = audio.createBufferSource()
  source.buffer = buffer
  const filter = audio.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = frequency
  filter.Q.value = 0.7
  const amp = audio.createGain()
  amp.gain.setValueAtTime(gain, start)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  source.connect(filter)
  filter.connect(amp)
  amp.connect(output)
  source.start(start)
  source.stop(start + dur + 0.02)
  track(source)
}

function crack(audio: AudioContext, output: GainNode, start: number): void {
  noiseBurst(audio, output, start, 0.16, 0.55, 2400)
  tone(audio, output, start, 1480, 0.18, 0.16, 'sawtooth', 90)
}

function impact(audio: AudioContext, output: GainNode, start: number): void {
  tone(audio, output, start, 180, 0.28, 0.45, 'sine', 48)
  noiseBurst(audio, output, start, 0.08, 0.2, 400)
}

function coin(audio: AudioContext, output: GainNode, start: number, freq: number): void {
  tone(audio, output, start, freq, 0.09, 0.11, 'triangle')
  tone(audio, output, start, freq * 2.71, 0.07, 0.05, 'sine')
}

function chord(audio: AudioContext, output: GainNode, start: number): void {
  const notes = [523.25, 659.25, 783.99]
  notes.forEach((freq, index) => {
    tone(audio, output, start + index * 0.045, freq, 0.55, 0.12, 'sine')
  })
  tone(audio, output, start + 0.12, 1567.98, 0.35, 0.05, 'triangle')
}
