import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { chordGroupsFromSchedule, isPracticeStepComplete } from '../engine/midiSchedule'
import { queryOsmdPageElements } from './osmdHorizontalPages'
import type { StaffHighlightState, StaffNoteIndexEntry } from './osmdStaffHighlight'
import { measureGrandStaffGeometry } from './osmdStaffGeometry'
import { logMidiOverlayPlacement, yForMidiOnGrandStaff } from './staffPitchY'

const TIME_EPS = 0.003
const LAYER_CLASS = 'pst-midi-sembreve-layer'
const PRESSED_COLOR = '#22c55e'
const WRONG_PRESS_COLOR = '#dc2626'

let lastOverlayKey = ''
let debugLoggedMidis = ''

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

function noteSvgRoot(entry: { graphicalNote: { getSVGGElement?: () => SVGGElement | undefined } }): SVGSVGElement | null {
  const g = entry.graphicalNote.getSVGGElement?.()
  const svg = g?.closest('svg')
  return svg instanceof SVGSVGElement ? svg : null
}

function noteSvgCenter(entry: { graphicalNote: { getSVGGElement?: () => SVGGElement | undefined } }): { x: number; y: number } | null {
  const g = entry.graphicalNote.getSVGGElement?.()
  if (!g) return null
  try {
    const box = g.getBBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  } catch {
    return null
  }
}

function yForMidi(
  midi: number,
  svg: SVGSVGElement,
  anchorX: number,
  logPress: boolean,
): number | null {
  const geom = measureGrandStaffGeometry(svg, anchorX)
  if (!geom) return null
  const placement = yForMidiOnGrandStaff(midi, geom)
  if (!placement) return null
  if (logPress) logMidiOverlayPlacement(placement)
  return placement.y
}

function anchorEntries(
  index: StaffNoteIndexEntry[],
  state: StaffHighlightState,
): StaffNoteIndexEntry[] {
  if (state.kind === 'practice') {
    const expected = entriesForPracticeTime(index, state.group.startSec, state.requiredMidis)
    if (expected.length) return expected
  }

  if (state.kind === 'playback') {
    const active = entriesAtPlayback(index, state.timeSec)
    if (active.length) return active

    const future = [...index]
      .filter((n) => n.startSec >= state.timeSec - TIME_EPS)
      .sort((a, b) => a.startSec - b.startSec)
    const t0 = future[0]?.startSec
    if (t0 != null) {
      const atT0 = index.filter((n) => Math.abs(n.startSec - t0) < TIME_EPS)
      if (atT0.length) return atT0
    }
  }

  const tMin = Math.min(...index.map((n) => n.startSec))
  return index.filter((n) => Math.abs(n.startSec - tMin) < TIME_EPS)
}

interface AnchorContext {
  svg: SVGSVGElement
  x: number
}

function anchorContext(index: StaffNoteIndexEntry[], state: StaffHighlightState): AnchorContext | null {
  const entries = anchorEntries(index, state)
  if (!entries.length) return null

  const svgCount = new Map<SVGSVGElement, StaffNoteIndexEntry[]>()
  for (const e of entries) {
    const svg = noteSvgRoot(e)
    if (!svg) continue
    const list = svgCount.get(svg)
    if (list) list.push(e)
    else svgCount.set(svg, [e])
  }

  let bestEntries: StaffNoteIndexEntry[] = []
  for (const list of svgCount.values()) {
    if (list.length > bestEntries.length) bestEntries = list
  }
  if (!bestEntries.length) return null

  const svg = noteSvgRoot(bestEntries[0])
  if (!svg) return null

  let sum = 0
  let count = 0
  for (const e of bestEntries) {
    const c = noteSvgCenter(e)
    if (!c) continue
    sum += c.x
    count++
  }
  if (!count) return null

  return { svg, x: sum / count }
}

function playbackChordGroupKey(index: StaffNoteIndexEntry[], timeSec: number): string {
  const groups = chordGroupsFromSchedule(
    index.map((e) => ({
      midi: e.midi,
      startSec: e.startSec,
      durationSec: e.durationSec,
      velocity: 90,
    })),
  )
  let idx = 0
  for (let g = 0; g < groups.length; g++) {
    const gr = groups[g]
    if (timeSec + TIME_EPS >= gr.startSec && timeSec < gr.startSec + gr.durationSec) {
      return String(g)
    }
    if (gr.startSec <= timeSec) idx = g
  }
  return String(idx)
}

function midiKey(midis?: Set<number>): string {
  if (!midis?.size) return ''
  return [...midis].sort((a, b) => a - b).join(',')
}

function overlayStateKey(
  index: StaffNoteIndexEntry[],
  state: StaffHighlightState | null | undefined,
  midiPressed?: Set<number>,
): string {
  if (!state || !midiPressed?.size) return ''
  const midis = midiKey(midiPressed)
  if (state.kind === 'practice') {
    const matched = [...state.matchedMidis].sort((a, b) => a - b).join(',')
    const wrong = [...(state.wrongPressOverlayMidis ?? [])].sort((a, b) => a - b).join(',')
    return `practice|${state.group.startSec}|${matched}|${wrong}|${midis}`
  }
  if (state.kind === 'playback') {
    return `playback|${playbackChordGroupKey(index, state.timeSec)}|${midis}`
  }
  return `idle|start|${midis}`
}

function midisToShow(
  state: StaffHighlightState,
  midiPressed: Set<number>,
): { midi: number; color: string }[] {
  if (!midiPressed.size) return []

  if (state.kind === 'practice') {
    const wrong = new Set(state.wrongPressOverlayMidis ?? [])
    if (!wrong.size) return []
    const stepComplete = isPracticeStepComplete(state.requiredMidis, state.matchedMidis)
    if (stepComplete) return []

    const out: { midi: number; color: string }[] = []
    for (const midi of midiPressed) {
      if (wrong.has(midi)) out.push({ midi, color: WRONG_PRESS_COLOR })
    }
    return out
  }

  return [...midiPressed].map((midi) => ({ midi, color: PRESSED_COLOR }))
}

function ensureLayer(svg: SVGSVGElement): SVGGElement {
  let layer = svg.querySelector(`g.${LAYER_CLASS}`) as SVGGElement | null
  if (!layer) {
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    layer.setAttribute('class', LAYER_CLASS)
    layer.setAttribute('pointer-events', 'none')
    svg.appendChild(layer)
  }
  return layer
}

function createSemibreve(x: number, y: number, color: string): SVGGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.setAttribute('class', 'pst-midi-sembreve')
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
  head.setAttribute('cx', String(x))
  head.setAttribute('cy', String(y))
  head.setAttribute('rx', '5.8')
  head.setAttribute('ry', '3.9')
  head.setAttribute('fill', color)
  head.setAttribute('transform', `rotate(-15 ${x} ${y})`)
  g.appendChild(head)
  return g
}

export function clearMidiSemibreveOverlay(
  container: HTMLElement | null | undefined,
  resetOverlayKey = true,
): void {
  if (!container) return
  if (resetOverlayKey) lastOverlayKey = ''
  for (const page of queryOsmdPageElements(container)) {
    for (const layer of page.querySelectorAll(`g.${LAYER_CLASS}`)) {
      layer.replaceChildren()
    }
  }
}

export function updateMidiSemibreveOverlay(
  _osmd: OpenSheetMusicDisplay,
  container: HTMLElement | null | undefined,
  index: StaffNoteIndexEntry[],
  state: StaffHighlightState | null | undefined,
  midiPressed?: Set<number>,
): void {
  const key = overlayStateKey(index, state, midiPressed)
  if (!key) {
    if (lastOverlayKey) {
      clearMidiSemibreveOverlay(container)
      debugLoggedMidis = ''
    }
    return
  }
  if (key === lastOverlayKey) return

  clearMidiSemibreveOverlay(container, false)
  lastOverlayKey = key

  if (!container || !state || !index.length || !midiPressed?.size) return

  const notes = midisToShow(state, midiPressed)
  if (!notes.length) return

  const anchor = anchorContext(index, state)
  if (!anchor) return

  const prevHeld = new Set(
    debugLoggedMidis
      .split(',')
      .filter(Boolean)
      .map((n) => Number(n)),
  )

  const layer = ensureLayer(anchor.svg)
  for (const { midi, color } of notes) {
    const logPress = !prevHeld.has(midi)
    const y = yForMidi(midi, anchor.svg, anchor.x, logPress)
    if (y == null) continue
    layer.appendChild(createSemibreve(anchor.x, y, color))
  }

  debugLoggedMidis = midiPressed?.size ? midiKey(midiPressed) : ''
}