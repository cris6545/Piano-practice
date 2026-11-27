import type { GrandStaffGeometry } from './osmdStaffGeometry'

/** C=0 … B=6 within octave; MIDI 60 = C4 → diatonic index 28. */
const PC_TO_DIATONIC: readonly number[] = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]

export const MIDDLE_C_MIDI = 60
const TREBLE_BOTTOM_MIDI = 64 // E4 bottom line
const BASS_BOTTOM_MIDI = 43 // G2 bottom line

/** Steps from E4 down to middle C (per product spec). */
const MIDDLE_C_STEPS_BELOW_TREBLE_BOTTOM = 5

export type ChosenStaff = 'treble' | 'bass' | 'middleC'

export function diatonicIndex(midi: number): number {
  const octave = Math.floor(midi / 12) - 1
  const pc = ((midi % 12) + 12) % 12
  return octave * 7 + PC_TO_DIATONIC[pc]
}

export function resolveChosenStaff(midi: number): ChosenStaff {
  if (midi === MIDDLE_C_MIDI) return 'middleC'
  if (midi > MIDDLE_C_MIDI) return 'treble'
  return 'bass'
}

export interface MidiOverlayPlacement {
  midiNote: number
  diatonicIndex: number
  chosenStaff: ChosenStaff
  staffTopY: number
  lineSpacing: number
  y: number
}

/** One diatonic step = half of the distance between adjacent staff lines. */
function halfLineStep(lineSpacing: number): number {
  return lineSpacing / 2
}

/**
 * Treble: anchor to bottom line E4; upward (higher pitch) → smaller Y.
 * Middle C: five diatonic half-steps below E4 bottom line.
 * Bass: anchor to bottom line G2.
 */
export function yForMidiOnGrandStaff(midi: number, geom: GrandStaffGeometry): MidiOverlayPlacement | null {
  const dIdx = diatonicIndex(midi)
  const chosenStaff = resolveChosenStaff(midi)

  if (chosenStaff === 'middleC') {
    const { bottomLineY, lineSpacing } = geom.treble
    const half = halfLineStep(lineSpacing)
    const y = bottomLineY + MIDDLE_C_STEPS_BELOW_TREBLE_BOTTOM * half
    return {
      midiNote: midi,
      diatonicIndex: dIdx,
      chosenStaff,
      staffTopY: geom.treble.topLineY,
      lineSpacing,
      y,
    }
  }

  if (chosenStaff === 'treble') {
    const { topLineY, bottomLineY, lineSpacing } = geom.treble
    const half = halfLineStep(lineSpacing)
    const stepsFromBottom = dIdx - diatonicIndex(TREBLE_BOTTOM_MIDI)
    const y = bottomLineY - stepsFromBottom * half
    return {
      midiNote: midi,
      diatonicIndex: dIdx,
      chosenStaff,
      staffTopY: topLineY,
      lineSpacing,
      y,
    }
  }

  const { topLineY, bottomLineY, lineSpacing } = geom.bass
  const half = halfLineStep(lineSpacing)
  const stepsFromBottom = dIdx - diatonicIndex(BASS_BOTTOM_MIDI)
  const y = bottomLineY - stepsFromBottom * half
  return {
    midiNote: midi,
    diatonicIndex: dIdx,
    chosenStaff,
    staffTopY: topLineY,
    lineSpacing,
    y,
  }
}

const DEBUG_MIDI_SEMIBREVE = true

export function logMidiOverlayPlacement(placement: MidiOverlayPlacement): void {
  if (!DEBUG_MIDI_SEMIBREVE) return
  console.log('[midi-semibreve]', {
    midiNote: placement.midiNote,
    diatonicIndex: placement.diatonicIndex,
    chosenStaff: placement.chosenStaff,
    staffTopY: placement.staffTopY,
    lineSpacing: placement.lineSpacing,
    y: placement.y,
  })
}