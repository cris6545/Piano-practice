export type SourceType = 'musicxml' | 'mxl' | 'mid'

/** Authoritative timeline for play + practice (seconds). */
export interface ScheduledNote {
  midi: number
  startSec: number
  durationSec: number
  velocity: number
}

export interface ChordGroup {
  startSec: number
  durationSec: number
  midis: number[]
}

export interface Song {
  id?: number
  title: string
  composer?: string
  sourceType: SourceType
  /** For OSMD — from file or MIDI-derived preview. */
  musicXml: string
  originalFileName: string
  /** Raw upload bytes (MIDI / MXL / MusicXML). */
  originalData?: ArrayBuffer
  /** Cached timeline built at import. */
  schedule: ScheduledNote[]
  addedAt: number
}

export interface SongProgress {
  id?: number
  songId: number
  practiceGroupIndex?: number
  updatedAt: number
}

export type PlayerMode = 'idle' | 'practice' | 'practice-select' | 'playback'