import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

const EXPECTED_COLOR = '#f59e0b'
const HIT_COLOR = '#22c55e'

export function resetNoteColors(osmd: OpenSheetMusicDisplay): void {
  if ('clearHighlightedSheetMusic' in osmd && typeof osmd.clearHighlightedSheetMusic === 'function') {
    osmd.clearHighlightedSheetMusic()
    return
  }
  osmd.render()
}

export function highlightCursorNotes(osmd: OpenSheetMusicDisplay, color = EXPECTED_COLOR): void {
  osmd.cursor.update()
  for (const g of notesUnderCursor(osmd)) {
    g.setColor(color, color)
  }
}

export function markCursorNotesHit(osmd: OpenSheetMusicDisplay): void {
  for (const g of notesUnderCursor(osmd)) {
    g.setColor(HIT_COLOR, HIT_COLOR)
  }
}

export function getExpectedMidiFromCursor(osmd: OpenSheetMusicDisplay): number[] {
  const iterator = osmd.cursor?.Iterator
  if (!iterator) return []

  const midis: number[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries: any[] = voiceEntries(iterator)

  for (const ve of entries) {
    for (const note of ve.Notes ?? []) {
      if (note.isRest?.()) continue
      const pitch = note.Pitch
      if (!pitch) continue
      if (typeof pitch.getHalfTone === 'function') {
        midis.push(pitch.getHalfTone())
      } else if (typeof pitch.HalfTone === 'number') {
        midis.push(pitch.HalfTone)
      }
    }
  }

  return [...new Set(midis)]
}

export function advanceCursor(osmd: OpenSheetMusicDisplay): boolean {
  if (osmd.cursor.Iterator?.EndReached) return false
  osmd.cursor.next()
  return !osmd.cursor.Iterator?.EndReached
}

export function cursorAtStart(osmd: OpenSheetMusicDisplay): void {
  osmd.cursor.reset()
  osmd.cursor.show()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function voiceEntries(iterator: any): any[] {
  if (Array.isArray(iterator.CurrentVisibleVoiceEntries)) {
    return iterator.CurrentVisibleVoiceEntries
  }
  if (Array.isArray(iterator.CurrentVoiceEntries)) {
    return iterator.CurrentVoiceEntries
  }
  return []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function notesUnderCursor(osmd: OpenSheetMusicDisplay): any[] {
  const iterator = osmd.cursor?.Iterator
  if (!iterator) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = []

  for (const ve of voiceEntries(iterator)) {
    for (const note of ve.Notes ?? []) {
      if (note.isRest?.()) continue
      const g = note.ParentVoiceEntry?.ParentStaffEntry?.graphicalNotes?.[0]
      if (g) out.push(g)
    }
  }
  return out
}