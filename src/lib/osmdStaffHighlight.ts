import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { ChordGroup, ScheduledNote } from '../types/song'
import { chordGroupsFromSchedule, isPracticeStepComplete } from '../engine/midiSchedule'
import {
  resetPlaybackScrollMotion,
  updatePlaybackSnapScroll,
  type PageLayout,
} from './osmdPlaybackScroll'
import { clearMidiSemibreveOverlay } from './osmdMidiSemibreve'

const TIME_EPS = 0.003
/** Same split as midiToMusicXml / grand-staff convention. */
const TREBLE_STAFF_MIDI = 60
const PLAYBACK_COLOR = '#2563eb'
const PRACTICE_COLOR = '#f59e0b'
const PRESSED_COLOR = '#22c55e'

export type StaffHighlightState =
  | { kind: 'playback'; timeSec: number }
  | {
      kind: 'practice'
      group: ChordGroup
      requiredMidis: number[]
      matchedMidis: number[]
      /** Wrong note-ons on this step only (not keys held over from the prior step). */
      wrongPressOverlayMidis?: number[]
    }
  | { kind: 'idle' }

interface GraphicalNoteLike {
  setColor: (fill: string, stroke: string, opts?: { applyToLyrics?: boolean }) => void
  getSVGGElement?: () => SVGGElement | undefined
}

export interface StaffNoteIndexEntry {
  graphicalNote: GraphicalNoteLike
  midi: number
  startSec: number
  durationSec: number
  measureIndex?: number
  pageIndex?: number
}

/** Rendered pitch on the score — actual notehead MIDI, not schedule-aligned. */
export interface ScorePitchIndexEntry {
  graphicalNote: GraphicalNoteLike
  midi: number
  staffIsTreble: boolean
  pageIndex: number
}

interface SourceCollected {
  graphicalNote: GraphicalNoteLike
  midi: number
  staffIsTreble: boolean
  measureIndex: number
  pageIndex: number
}

function pageIndexForGraphicalNote(gn: unknown): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = gn as any
  const measure = g.parentVoiceEntry?.parentStaffEntry?.parentMeasure
  const system = measure?.parentMusicSystem ?? measure?.ParentMusicSystem
  const page = system?.parentMusicPage ?? system?.ParentMusicPage
  const num = page?.PageNumber ?? page?.pageNumber ?? 1
  return Math.max(0, Number(num) - 1)
}

let lastColored: GraphicalNoteLike[] = []

function defaultInk(osmd: OpenSheetMusicDisplay): string {
  return osmd.EngravingRules?.DefaultColorMusic ?? '#000000'
}

function clearLastColored(osmd: OpenSheetMusicDisplay): void {
  const ink = defaultInk(osmd)
  for (const gn of lastColored) {
    try {
      gn.setColor(ink, ink, { applyToLyrics: false })
    } catch {
      /* ignore */
    }
  }
  lastColored = []
}

/** Same order as sounding events: by time, then treble→bass / lower midi within a chord. */
function scheduleInScoreOrder(schedule: ScheduledNote[]): ScheduledNote[] {
  const groups = chordGroupsFromSchedule(schedule)
  const out: ScheduledNote[] = []
  for (const g of groups) {
    const notes = schedule.filter((n) => Math.abs(n.startSec - g.startSec) < TIME_EPS)
    const treble = notes.filter((n) => n.midi >= TREBLE_STAFF_MIDI).sort((a, b) => a.midi - b.midi)
    const bass = notes.filter((n) => n.midi < TREBLE_STAFF_MIDI).sort((a, b) => a.midi - b.midi)
    out.push(...treble, ...bass)
  }
  return out
}

/**
 * Walk OSMD's source score in chronological order (vertical staff slices),
 * not staff-line-by-staff-line — that order broke grand-staff pairing.
 */
function collectSourceNotesInScoreOrder(osmd: OpenSheetMusicDisplay): SourceCollected[] {
  const out: SourceCollected[] = []
  const rules = osmd.EngravingRules
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheet = osmd.Sheet as any
  if (!sheet?.SourceMeasures) return out

  for (let measureIndex = 0; measureIndex < sheet.SourceMeasures.length; measureIndex++) {
    const measure = sheet.SourceMeasures[measureIndex]
    const containers = measure.VerticalSourceStaffEntryContainers as
      | {
          StaffEntries?: {
            ParentStaff?: { Id?: number; StaffId?: number }
            parentStaff?: { Id?: number; StaffId?: number }
            VoiceEntries?: {
              Notes?: {
                isRest?: () => boolean
                Pitch?: { getHalfTone?: () => number }
              }[]
            }[]
          }[]
        }[]
      | undefined

    for (const container of containers ?? []) {
      const batch: {
        graphicalNote: GraphicalNoteLike
        midi: number
        staffIsTreble: boolean
        measureIndex: number
        pageIndex: number
      }[] = []

      for (let staffIdx = 0; staffIdx < (container.StaffEntries?.length ?? 0); staffIdx++) {
        const staffEntry = container.StaffEntries?.[staffIdx]
        if (!staffEntry) continue
        const staffIsTreble = staffIdx === 0

        for (const ve of staffEntry.VoiceEntries ?? []) {
          for (const note of ve.Notes ?? []) {
            if (note.isRest?.()) continue
            const midi = note.Pitch?.getHalfTone?.()
            if (midi == null) continue
            let gn: GraphicalNoteLike | undefined
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              gn = rules.GNote(note as any) as GraphicalNoteLike
            } catch {
              gn = undefined
            }
            if (!gn) continue
            batch.push({
              graphicalNote: gn,
              midi,
              staffIsTreble,
              measureIndex,
              pageIndex: pageIndexForGraphicalNote(gn),
            })
          }
        }
      }

      batch.sort((a, b) => {
        const aRow = a.midi >= TREBLE_STAFF_MIDI ? 0 : 1
        const bRow = b.midi >= TREBLE_STAFF_MIDI ? 0 : 1
        return aRow - bRow || Number(a.staffIsTreble) - Number(b.staffIsTreble) || a.midi - b.midi
      })
      for (const b of batch) {
        out.push({
          graphicalNote: b.graphicalNote,
          midi: b.midi,
          staffIsTreble: b.staffIsTreble,
          measureIndex: b.measureIndex,
          pageIndex: b.pageIndex,
        })
      }
    }
  }

  return out
}

/**
 * Map playback schedule entries to rendered noteheads 1:1 in score order.
 * Uses schedule times for highlighting (MIDI timing stays authoritative for playback).
 */
export function buildStaffNoteIndex(
  osmd: OpenSheetMusicDisplay,
  schedule: ScheduledNote[],
): StaffNoteIndexEntry[] {
  const graphical = collectSourceNotesInScoreOrder(osmd)
  const timed = scheduleInScoreOrder(schedule)
  const index: StaffNoteIndexEntry[] = []
  const n = Math.min(graphical.length, timed.length)

  for (let i = 0; i < n; i++) {
    index.push({
      graphicalNote: graphical[i].graphicalNote,
      midi: timed[i].midi,
      startSec: timed[i].startSec,
      durationSec: timed[i].durationSec,
      measureIndex: graphical[i].measureIndex,
      pageIndex: graphical[i].pageIndex,
    })
  }

  return index
}

/** Notehead positions from engraved pitches — used for staff Y alignment (MIDI overlay). */
export function buildScorePitchIndex(osmd: OpenSheetMusicDisplay): ScorePitchIndexEntry[] {
  return collectSourceNotesInScoreOrder(osmd).map((n) => ({
    graphicalNote: n.graphicalNote,
    midi: n.midi,
    staffIsTreble: n.staffIsTreble,
    pageIndex: n.pageIndex,
  }))
}

function entriesAtPlayback(index: StaffNoteIndexEntry[], timeSec: number): StaffNoteIndexEntry[] {
  return index.filter((n) => timeSec >= n.startSec && timeSec < n.startSec + n.durationSec)
}

function entriesForPracticeTime(
  index: StaffNoteIndexEntry[],
  timeSec: number,
  requiredMidis: number[],
): StaffNoteIndexEntry[] {
  const required = new Set(requiredMidis)
  const atTime = index.filter((n) => Math.abs(n.startSec - timeSec) < TIME_EPS)
  if (atTime.length) {
    const onScore = atTime.filter((n) => required.has(n.midi))
    return onScore.length ? onScore : atTime
  }
  return index.filter((n) => required.has(n.midi) && Math.abs(n.startSec - timeSec) < 0.25)
}

export function updateStaffHighlight(
  osmd: OpenSheetMusicDisplay,
  index: StaffNoteIndexEntry[],
  state: StaffHighlightState | null | undefined,
  scrollContainer?: HTMLElement | null,
  pageLayouts?: PageLayout[] | null,
  _midiPressed?: Set<number>,
): void {
  clearLastColored(osmd)
  if (!state || !index.length) {
    clearMidiSemibreveOverlay(scrollContainer)
    resetPlaybackScrollMotion()
    return
  }

  const paint = (entries: StaffNoteIndexEntry[], color: string) => {
    for (const e of entries) {
      try {
        e.graphicalNote.setColor(color, color, { applyToLyrics: false })
        lastColored.push(e.graphicalNote)
      } catch {
        /* ignore */
      }
    }
  }

  if (state.kind === 'playback') {
    const active = entriesAtPlayback(index, state.timeSec)
    paint(active, PLAYBACK_COLOR)
    if (scrollContainer && pageLayouts?.length) {
      updatePlaybackSnapScroll(scrollContainer, index, pageLayouts, state.timeSec)
    }
    return
  }

  if (state.kind === 'idle') {
    resetPlaybackScrollMotion()
    return
  }

  resetPlaybackScrollMotion()

  const expected = entriesForPracticeTime(index, state.group.startSec, state.requiredMidis)
  const stepComplete = isPracticeStepComplete(state.requiredMidis, state.matchedMidis)
  const color = stepComplete ? PRESSED_COLOR : PRACTICE_COLOR
  paint(expected, color)
}