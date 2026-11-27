import type { ScheduledNote } from '../types/song'
import { playbackDurationSec } from '../engine/midiSchedule'
import { ensureReady, playNote, stopAll, getAudioContext } from './pianoAudio'

let playbackStartCtx = 0
let playbackOffsetSec = 0
let playbackEndTimer: ReturnType<typeof setTimeout> | null = null
let positionRaf = 0
let noteIndex = 0
let activeNotes: ScheduledNote[] = []
let playbackSession = 0

const LOOKAHEAD_SEC = 0.05

/** @tonejs/midi uses 0–1; smplr / playNote expect 1–127. */
function velocity127(v: number): number {
  const n = v <= 1 ? Math.round(v * 127) : Math.round(v)
  return Math.max(1, Math.min(127, n))
}

export function stopPlaybackAudio(): void {
  playbackSession += 1
  if (playbackEndTimer) {
    clearTimeout(playbackEndTimer)
    playbackEndTimer = null
  }
  cancelAnimationFrame(positionRaf)
  positionRaf = 0
  stopAll()
  playbackStartCtx = 0
  noteIndex = 0
  activeNotes = []
}

export function getPlaybackPositionSec(): number {
  const ctx = getAudioContext()
  if (playbackStartCtx <= 0) return playbackOffsetSec
  return playbackOffsetSec + (ctx.currentTime - playbackStartCtx)
}

export async function schedulePlayback(
  notes: ScheduledNote[],
  fromSec: number,
  onPosition: (sec: number) => void,
  onEnded: () => void,
  endSec?: number,
): Promise<void> {
  stopPlaybackAudio()
  const session = ++playbackSession

  if (!notes.length) {
    onEnded()
    return
  }

  await ensureReady()
  if (session !== playbackSession) return

  const ctx = getAudioContext()
  const t0 = ctx.currentTime + 0.05
  playbackStartCtx = t0
  playbackOffsetSec = fromSec

  const songEnd = endSec ?? playbackDurationSec(notes)
  const hardEnd = endSec != null ? songEnd : null

  activeNotes = notes
    .filter((n) => {
      if (n.startSec < fromSec - 0.001) return false
      if (hardEnd != null) return n.startSec < hardEnd - 0.0005
      return n.startSec < songEnd + 0.001
    })
    .sort((a, b) => a.startSec - b.startSec || a.midi - b.midi)
  noteIndex = 0

  if (activeNotes.length === 0 || fromSec >= songEnd - 0.001) {
    onEnded()
    return
  }

  const remaining = songEnd - fromSec
  const tailMs = hardEnd != null ? 80 : 500

  playbackEndTimer = setTimeout(() => {
    if (session !== playbackSession) return
    playbackEndTimer = null
    cancelAnimationFrame(positionRaf)
    onEnded()
  }, remaining * 1000 + tailMs)

  const tick = () => {
    if (session !== playbackSession || !playbackEndTimer) return

    const pos = getPlaybackPositionSec()
    onPosition(hardEnd != null ? Math.min(pos, songEnd) : pos)

    const now = getAudioContext().currentTime
    const lookahead =
      hardEnd != null ? Math.min(LOOKAHEAD_SEC, Math.max(0, hardEnd - pos)) : LOOKAHEAD_SEC

    while (noteIndex < activeNotes.length) {
      const n = activeNotes[noteIndex]
      if (hardEnd != null && n.startSec >= hardEnd - 0.0005) break
      if (n.startSec > pos + lookahead) break
      noteIndex++
      const when = Math.max(now, playbackStartCtx + (n.startSec - playbackOffsetSec))
      const duration =
        hardEnd != null ? Math.min(n.durationSec, Math.max(0.02, hardEnd - n.startSec)) : n.durationSec
      playNote(n.midi, velocity127(n.velocity), duration, when)
    }

    const done =
      hardEnd != null
        ? pos >= hardEnd - 0.001 && noteIndex >= activeNotes.length
        : noteIndex >= activeNotes.length && pos >= songEnd - 0.05
    if (done) {
      if (playbackEndTimer) {
        clearTimeout(playbackEndTimer)
        playbackEndTimer = null
      }
      onEnded()
      return
    }

    positionRaf = requestAnimationFrame(tick)
  }
  positionRaf = requestAnimationFrame(tick)
}