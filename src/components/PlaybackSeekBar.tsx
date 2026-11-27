import { useCallback, useRef } from 'react'
import './PlaybackSeekBar.css'

interface PlaybackSeekBarProps {
  positionSec: number
  durationSec: number
  formatTime: (sec: number) => string
  onSeek: (sec: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
}

export function PlaybackSeekBar({
  positionSec,
  durationSec,
  formatTime,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: PlaybackSeekBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const scrubbingRef = useRef(false)

  const secFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || durationSec <= 0) return 0
      const { left, width } = el.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - left) / width))
      return ratio * durationSec
    },
    [durationSec],
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (durationSec <= 0) return
    e.preventDefault()
    scrubbingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    onScrubStart?.()
    onSeek(secFromClientX(e.clientX))
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current || durationSec <= 0) return
    onSeek(secFromClientX(e.clientX))
  }

  const endScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    onScrubEnd?.()
  }

  const progress = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0

  return (
    <div className="playback-seek" aria-label="Song timeline">
      <span className="playback-seek-time">{formatTime(positionSec)}</span>
      <div
        ref={trackRef}
        className="playback-seek-track"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        aria-valuenow={Math.round(positionSec)}
        aria-valuetext={`${formatTime(positionSec)} of ${formatTime(durationSec)}`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onKeyDown={(e) => {
          if (durationSec <= 0) return
          const step = e.shiftKey ? 5 : 1
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            onSeek(Math.max(0, positionSec - step))
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            onSeek(Math.min(durationSec, positionSec + step))
          }
        }}
      >
        <div className="playback-seek-fill" style={{ width: `${progress * 100}%` }} />
        <div className="playback-seek-thumb" style={{ left: `${progress * 100}%` }} />
      </div>
      <span className="playback-seek-time playback-seek-duration">{formatTime(durationSec)}</span>
    </div>
  )
}