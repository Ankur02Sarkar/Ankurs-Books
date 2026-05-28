'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  PlayIcon,
  PauseIcon,
  GoBackward10SecIcon,
  GoForward10SecIcon,
  VolumeHighIcon,
  VolumeMute01Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

type Props = {
  audioUrl: string
  hymnKey: string // unique key for sessionStorage (e.g. "book-1-hymn-3")
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

function formatTime(secs: number): string {
  if (!Number.isFinite(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AudioPlayer({ audioUrl, hymnKey }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [muted, setMuted] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const storageKey = `audio-pos-${hymnKey}`

  // Restore saved position + speed on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved) {
        const { time, spd } = JSON.parse(saved)
        if (audioRef.current && Number.isFinite(time)) {
          audioRef.current.currentTime = time
        }
        if (SPEEDS.includes(spd)) setSpeed(spd)
      }
    } catch {}
  }, [storageKey])

  // Sync speed to audio element
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  // Sync muted
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted
  }, [muted])

  const savePosition = useCallback(() => {
    try {
      if (audioRef.current) {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ time: audioRef.current.currentTime, spd: speed }),
        )
      }
    } catch {}
  }, [storageKey, speed])

  // Save on unload
  useEffect(() => {
    window.addEventListener('beforeunload', savePosition)
    return () => window.removeEventListener('beforeunload', savePosition)
  }, [savePosition])

  // Global keyboard shortcuts: Space = play/pause, ←/→ = skip ±10s
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't fire when typing in an input, textarea, select, or contenteditable
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return
      if (!loaded) return

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        skip(-10)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        skip(10)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, isPlaying, duration])

  function handleLoadedMetadata() {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
      setLoaded(true)
    }
  }

  function handleTimeUpdate() {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
  }

  function handleEnded() {
    setIsPlaying(false)
    savePosition()
  }

  function handleError() {
    setError(true)
    setLoaded(false)
  }

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (isPlaying) {
      a.pause()
      savePosition()
    } else {
      a.play()
    }
    setIsPlaying(!isPlaying)
  }

  function skip(delta: number) {
    if (!audioRef.current) return
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(duration, audioRef.current.currentTime + delta),
    )
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(e.target.value)
    if (audioRef.current) audioRef.current.currentTime = val
    setCurrentTime(val)
  }

  function cycleSpeed() {
    const idx = SPEEDS.indexOf(speed)
    const next = SPEEDS[(idx + 1) % SPEEDS.length]
    setSpeed(next)
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  if (error) return null

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card px-4 py-3',
        'transition-opacity duration-300',
        !loaded && 'opacity-60',
      )}
    >
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
        onError={handleError}
      />

      {/* Progress bar */}
      <div className="mb-3 flex items-center gap-2">
        <span className="w-10 text-right font-mono text-xs text-muted-foreground tabular-nums">
          {formatTime(currentTime)}
        </span>
        <div className="relative flex-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            disabled={!loaded}
            aria-label="Seek audio"
            className={cn(
              'absolute inset-0 h-full w-full cursor-pointer opacity-0',
              !loaded && 'cursor-not-allowed',
            )}
          />
        </div>
        <span className="w-10 font-mono text-xs text-muted-foreground tabular-nums">
          {formatTime(duration)}
        </span>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between gap-2">
        {/* Transport */}
        <div className="flex items-center gap-1">
          <IconButton
            onClick={() => skip(-10)}
            label="Skip back 10 seconds"
            disabled={!loaded}
          >
            <HugeiconsIcon
              icon={GoBackward10SecIcon}
              size={18}
              color="currentColor"
              strokeWidth={1.5}
            />
          </IconButton>

          <button
            type="button"
            onClick={togglePlay}
            disabled={!loaded}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className={cn(
              'flex size-9 items-center justify-center rounded-full',
              'bg-primary text-primary-foreground',
              'transition-transform hover:scale-105 active:scale-95',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <HugeiconsIcon
              icon={isPlaying ? PauseIcon : PlayIcon}
              size={18}
              color="currentColor"
              strokeWidth={1.5}
            />
          </button>

          <IconButton
            onClick={() => skip(10)}
            label="Skip forward 10 seconds"
            disabled={!loaded}
          >
            <HugeiconsIcon
              icon={GoForward10SecIcon}
              size={18}
              color="currentColor"
              strokeWidth={1.5}
            />
          </IconButton>
        </div>

        {/* Right controls: speed + mute */}
        <div className="flex items-center gap-2">
          {/* Speed pill */}
          <button
            type="button"
            onClick={cycleSpeed}
            disabled={!loaded}
            aria-label={`Playback speed: ${speed}×. Click to change.`}
            className={cn(
              'rounded-full border border-border px-2.5 py-0.5',
              'font-mono text-xs text-muted-foreground',
              'transition-colors hover:border-primary hover:text-primary',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {speed}×
          </button>

          {/* Mute */}
          <IconButton
            onClick={() => setMuted((m) => !m)}
            label={muted ? 'Unmute' : 'Mute'}
            disabled={!loaded}
          >
            <HugeiconsIcon
              icon={muted ? VolumeMute01Icon : VolumeHighIcon}
              size={16}
              color="currentColor"
              strokeWidth={1.5}
            />
          </IconButton>
        </div>
      </div>

      {/* Loading indicator */}
      {!loaded && !error && (
        <p className="mt-2 text-center text-xs text-muted-foreground">Loading audio…</p>
      )}
    </div>
  )
}

// ── Small icon button ─────────────────────────────────────────────────────────
function IconButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: () => void
  label: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex size-8 items-center justify-center rounded-full',
        'text-muted-foreground transition-colors',
        'hover:bg-muted hover:text-foreground',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {children}
    </button>
  )
}
