import { Midi } from '@tonejs/midi'
import type { ChordGroup, ScheduledNote } from '../types/song'

const CHORD_EPSILON = 0.001
/** Grand-staff / multi-track notes may differ by a few ms — one practice step per moment. */
export const PRACTICE_TIME_EPS = 0.03

/** Build play timeline from raw MIDI — same basis as Midiano / @tonejs/midi. */
export function buildScheduleFromMidi(buffer: ArrayBuffer): ScheduledNote[] {
  const midi = new Midi(buffer)
  const notes: ScheduledNote[] = []

  for (const track of midi.tracks) {
    for (const n of track.notes) {
      const velocity = n.velocity <= 1 ? Math.round(n.velocity * 127) : Math.round(n.velocity)
      notes.push({
        midi: n.midi,
        startSec: n.time,
        durationSec: Math.max(0.02, n.duration),
        velocity: Math.max(1, Math.min(127, velocity)),
      })
    }
  }

  return notes.sort((a, b) => a.startSec - b.startSec || a.midi - b.midi)
}

export function chordGroupsFromSchedule(notes: ScheduledNote[]): ChordGroup[] {
  if (!notes.length) return []

  const groups: ChordGroup[] = []
  let current: ChordGroup | null = null

  for (const n of notes) {
    if (
      current &&
      Math.abs(n.startSec - current.startSec) < CHORD_EPSILON
    ) {
      if (!current.midis.includes(n.midi)) current.midis.push(n.midi)
      current.durationSec = Math.max(current.durationSec, n.durationSec)
    } else {
      current = {
        startSec: n.startSec,
        durationSec: n.durationSec,
        midis: [n.midi],
      }
      groups.push(current)
    }
  }

  return groups
}

export function midisAtPracticeTime(notes: ScheduledNote[], timeSec: number): number[] {
  const midis = new Set<number>()
  for (const n of notes) {
    if (Math.abs(n.startSec - timeSec) < PRACTICE_TIME_EPS) midis.add(n.midi)
  }
  return [...midis].sort((a, b) => a - b)
}

/** Each sounding note at this instant (duplicate midis kept — repeated pitches need separate presses). */
export function practiceMidisAtTime(notes: ScheduledNote[], timeSec: number): number[] {
  const midis: number[] = []
  for (const n of notes) {
    if (Math.abs(n.startSec - timeSec) < PRACTICE_TIME_EPS) midis.push(n.midi)
  }
  return midis.sort((a, b) => a - b)
}

export function isPracticeStepComplete(required: number[], matched: number[]): boolean {
  if (!required.length) return false
  const need = new Map<number, number>()
  for (const m of required) need.set(m, (need.get(m) ?? 0) + 1)
  const got = new Map<number, number>()
  for (const m of matched) got.set(m, (got.get(m) ?? 0) + 1)
  for (const [midi, count] of need) {
    if ((got.get(midi) ?? 0) < count) return false
  }
  return true
}

/** After completing a time slice, skip remaining chord groups still at that instant. */
export function nextPracticeGroupIndex(groups: ChordGroup[], current: number): number {
  if (current < 0 || current >= groups.length) return groups.length
  const t = groups[current].startSec
  for (let i = current + 1; i < groups.length; i++) {
    if (Math.abs(groups[i].startSec - t) >= PRACTICE_TIME_EPS) return i
  }
  return groups.length
}

export function playbackDurationSec(notes: ScheduledNote[]): number {
  if (!notes.length) return 0
  return notes.reduce((t, n) => Math.max(t, n.startSec + n.durationSec), 0)
}

export function midiTitle(buffer: ArrayBuffer, fileName: string): string {
  try {
    const midi = new Midi(buffer)
    return midi.name || fileName.replace(/\.(mid|midi)$/i, '')
  } catch {
    return fileName.replace(/\.(mid|midi)$/i, '')
  }
}