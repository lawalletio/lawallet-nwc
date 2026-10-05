'use client'

import { useEffect, useRef, useState } from 'react'
import { DotLottieReact, type DotLottie } from '@lottiefiles/dotlottie-react'
import { preloadTreasureChest } from '@/lib/client/treasure-chest-cache'

/** How much shorter the clip plays than its authored length. */
const VISUAL_SHORTER_BY_SEC = 1.1
/** Sound stays on the previous clock, 200ms longer than the picture. */
const SOUND_LONGER_BY_SEC = 0.2

function visualSeconds(nativeSec: number): number {
  return Math.max(0.4, nativeSec - VISUAL_SHORTER_BY_SEC)
}

function soundSeconds(nativeSec: number): number {
  return visualSeconds(nativeSec) + SOUND_LONGER_BY_SEC
}

/**
 * The Lottie chest from `/animations/treasure-chest.lottie` (300 frames, 60fps).
 * Charging holds the closed first frame. Celebrate plays it once.
 * Reduced motion jumps to the last frame.
 */
export function TreasureChest({
  play,
  reduced,
  runId,
  onStart
}: {
  play: boolean
  reduced: boolean
  runId: number
  /**
   * Fires when playback starts. `visualSec` drives the count and the bar.
   * `soundSec` is slightly longer so the sting still ends with the picture.
   */
  onStart?: (timing: { visualSec: number; soundSec: number }) => void
}) {
  const [data, setData] = useState<ArrayBuffer | null>(null)
  const [player, setPlayer] = useState<DotLottie | null>(null)
  const onStartRef = useRef(onStart)
  useEffect(() => {
    onStartRef.current = onStart
  }, [onStart])

  useEffect(() => {
    let cancelled = false
    preloadTreasureChest()
      .then(buffer => {
        if (!cancelled) setData(buffer.slice(0))
      })
      .catch(() => {
        // Leave the chest empty. A failed fetch must not throw into the claim.
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!player) return
    let started = false
    const begin = () => {
      if (started || reduced || !play) return
      started = true
      const native = player.duration || 5
      onStartRef.current?.({
        visualSec: visualSeconds(native),
        soundSec: soundSeconds(native)
      })
    }
    const sync = () => {
      if (!player.isLoaded) return
      if (reduced) {
        player.setFrame(Math.max(0, player.totalFrames - 1))
        return
      }
      if (!play) {
        player.pause()
        player.setFrame(0)
        return
      }
      const native = player.duration || 5
      player.setSpeed(native / visualSeconds(native))
      player.stop()
      player.setFrame(0)
      player.play()
    }
    if (player.isLoaded) sync()
    else player.addEventListener('load', sync)
    player.addEventListener('play', begin)
    return () => {
      player.removeEventListener('load', sync)
      player.removeEventListener('play', begin)
    }
  }, [player, play, reduced, runId])

  if (process.env.NODE_ENV === 'test' || !data) {
    return <div className="aspect-square w-[840px] shrink-0" />
  }

  return (
    <div className="pointer-events-none aspect-square w-[840px] shrink-0">
      <DotLottieReact
        data={data}
        autoplay={false}
        loop={false}
        dotLottieRefCallback={setPlayer}
        className="h-full w-full"
        aria-label="Treasure chest opening"
        role="img"
      />
    </div>
  )
}
