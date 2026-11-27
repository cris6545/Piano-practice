import { queryOsmdPageElements } from './osmdHorizontalPages'
import { measureGrandStaffGeometry } from './osmdStaffGeometry'
import { chordGroupsFromSchedule } from '../engine/midiSchedule'
import { PRACTICE_STEP_TIME_EPS } from './practiceSteps'
import type { StaffNoteIndexEntry } from './osmdStaffHighlight'

const SELECT_LAYER_CLASS = 'pst-practice-select-layer'
const SELECT_LINE_CLASS = 'pst-practice-select-line'
const SELECT_LINE_COLOR = '#7c3aed'

const COMPLETE_LAYER_CLASS = 'pst-practice-complete-layer'
const COMPLETE_LINE_CLASS = 'pst-practice-complete-line'
const COMPLETE_LINE_COLOR = '#16a34a'

interface BoundaryStyle {
  layerClass: string
  lineClass: string
  lineColor: string
}

export interface PracticeTimeRange {
  startSec: number
  /** Last selected note attack (inclusive) — practice steps stop here. */
  lastAttackSec: number
  /** Through end of last note — preview audio and tempo timing only. */
  endSec: number
  startGroupIndex: number
  endGroupIndex: number
}

interface NoteXContent {
  entry: StaffNoteIndexEntry
  centerX: number
  leftX: number
  rightX: number
}

function svgFromPageEl(page: HTMLElement): SVGSVGElement | null {
  const svg = page.querySelector('svg')
  return svg instanceof SVGSVGElement ? svg : null
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()?.inverse()
  if (!ctm) return null
  const p = pt.matrixTransform(ctm)
  return { x: p.x, y: p.y }
}

export function pointerOnGrandStaff(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): SVGSVGElement | null {
  for (const page of queryOsmdPageElements(container)) {
    const svg = svgFromPageEl(page)
    if (!svg) continue
    const r = page.getBoundingClientRect()
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue
    const p = clientToSvg(svg, clientX, clientY)
    if (!p) continue
    const geom = measureGrandStaffGeometry(svg, p.x)
    if (!geom) continue
    const pad = geom.treble.lineSpacing * 2.5
    if (p.y >= geom.treble.topLineY - pad && p.y <= geom.bass.bottomLineY + pad) {
      return svg
    }
  }
  return null
}

function buildNoteXContent(container: HTMLElement, index: StaffNoteIndexEntry[]): NoteXContent[] {
  const cRect = container.getBoundingClientRect()
  const scrollLeft = container.scrollLeft
  const out: NoteXContent[] = []

  for (const entry of index) {
    const g = entry.graphicalNote.getSVGGElement?.()
    if (!g) continue
    const r = g.getBoundingClientRect()
    const leftX = r.left - cRect.left + scrollLeft
    const rightX = r.right - cRect.left + scrollLeft
    out.push({
      entry,
      centerX: leftX + r.width / 2,
      leftX,
      rightX,
    })
  }

  return out
}

function nearestNoteAtX(notes: NoteXContent[], contentX: number): NoteXContent | null {
  if (!notes.length) return null
  let best = notes[0]
  let bestDist = Math.abs(best.centerX - contentX)
  for (let i = 1; i < notes.length; i++) {
    const d = Math.abs(notes[i].centerX - contentX)
    if (d < bestDist) {
      bestDist = d
      best = notes[i]
    }
  }
  return best
}

export function timeAtPointer(
  container: HTMLElement,
  index: StaffNoteIndexEntry[],
  clientX: number,
): number | null {
  const notes = buildNoteXContent(container, index)
  if (!notes.length) return null
  const cRect = container.getBoundingClientRect()
  const contentX = clientX - cRect.left + container.scrollLeft
  return nearestNoteAtX(notes, contentX)?.entry.startSec ?? null
}

export function practiceRangeFromTimes(
  index: StaffNoteIndexEntry[],
  anchorSec: number,
  currentSec: number,
): PracticeTimeRange | null {
  if (!index.length) return null

  const lo = Math.min(anchorSec, currentSec)
  const hi = Math.max(anchorSec, currentSec)
  const eps = PRACTICE_STEP_TIME_EPS

  const selected = index
    .filter((e) => e.startSec >= lo - eps && e.startSec <= hi + eps)
    .sort((a, b) => a.startSec - b.startSec || a.midi - b.midi)
  if (!selected.length) return null

  const startSec = selected[0].startSec
  const last = selected[selected.length - 1]
  const lastAttackSec = last.startSec
  const endSec = lastAttackSec + last.durationSec

  const schedule = index.map((e) => ({
    midi: e.midi,
    startSec: e.startSec,
    durationSec: e.durationSec,
    velocity: 90,
  }))
  const groups = chordGroupsFromSchedule(schedule)
  const startGroupIndex = groups.findIndex((g) => Math.abs(g.startSec - startSec) < eps)
  let endGroupIndex = -1
  for (let i = groups.length - 1; i >= 0; i--) {
    if (Math.abs(groups[i].startSec - lastAttackSec) < eps) {
      endGroupIndex = i
      break
    }
  }
  if (startGroupIndex < 0 || endGroupIndex < 0) return null

  return { startSec, lastAttackSec, endSec, startGroupIndex, endGroupIndex }
}

interface LineBounds {
  pageIndex: number
  beforeX: number
  afterX: number
}

function boundaryXs(
  container: HTMLElement,
  index: StaffNoteIndexEntry[],
  anchorSec: number,
  currentSec: number,
): LineBounds[] {
  const lo = Math.min(anchorSec, currentSec)
  const hi = Math.max(anchorSec, currentSec)
  const notes = buildNoteXContent(container, index).filter(
    (n) =>
      n.entry.startSec >= lo - PRACTICE_STEP_TIME_EPS && n.entry.startSec <= hi + PRACTICE_STEP_TIME_EPS,
  )
  if (!notes.length) return []

  const byPage = new Map<number, NoteXContent[]>()
  for (const n of notes) {
    const p = n.entry.pageIndex ?? 0
    const list = byPage.get(p) ?? []
    list.push(n)
    byPage.set(p, list)
  }

  const out: LineBounds[] = []
  for (const [pageIndex, pageNotes] of byPage) {
    let minLeft = Infinity
    let maxRight = -Infinity
    for (const n of pageNotes) {
      minLeft = Math.min(minLeft, n.leftX)
      maxRight = Math.max(maxRight, n.rightX)
    }
    const gap = 4
    out.push({ pageIndex, beforeX: minLeft - gap, afterX: maxRight + gap })
  }
  return out
}

function contentXToSvgX(svg: SVGSVGElement, container: HTMLElement, contentX: number): number | null {
  const cRect = container.getBoundingClientRect()
  const clientX = cRect.left + contentX - container.scrollLeft
  const p = clientToSvg(svg, clientX, cRect.top + 1)
  return p?.x ?? null
}

function ensureLayer(svg: SVGSVGElement, layerClass: string): SVGGElement {
  let layer = svg.querySelector(`g.${layerClass}`) as SVGGElement | null
  if (!layer) {
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    layer.setAttribute('class', layerClass)
    layer.setAttribute('pointer-events', 'none')
    svg.appendChild(layer)
  }
  return layer
}

function verticalLine(
  x: number,
  y0: number,
  y1: number,
  lineClass: string,
  lineColor: string,
): SVGLineElement {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line.setAttribute('class', lineClass)
  line.setAttribute('x1', String(x))
  line.setAttribute('x2', String(x))
  line.setAttribute('y1', String(Math.min(y0, y1)))
  line.setAttribute('y2', String(Math.max(y0, y1)))
  line.setAttribute('stroke', lineColor)
  line.setAttribute('stroke-width', '2')
  line.setAttribute('stroke-linecap', 'round')
  return line
}

function drawSectionBoundaryLines(
  container: HTMLElement,
  index: StaffNoteIndexEntry[],
  startSec: number,
  lastAttackSec: number,
  style: BoundaryStyle,
): void {
  if (!index.length) return

  const bounds = boundaryXs(container, index, startSec, lastAttackSec)
  const pages = queryOsmdPageElements(container)

  for (const b of bounds) {
    const page = pages[b.pageIndex]
    if (!page) continue
    const svg = svgFromPageEl(page)
    if (!svg) continue
    const geom = measureGrandStaffGeometry(svg, (b.beforeX + b.afterX) / 2)
    if (!geom) continue

    const pad = geom.treble.lineSpacing * 1.2
    const yTop = geom.treble.topLineY - pad
    const yBottom = geom.bass.bottomLineY + pad

    const xBefore = contentXToSvgX(svg, container, b.beforeX)
    const xAfter = contentXToSvgX(svg, container, b.afterX)
    if (xBefore == null || xAfter == null) continue

    const layer = ensureLayer(svg, style.layerClass)
    layer.appendChild(verticalLine(xBefore, yTop, yBottom, style.lineClass, style.lineColor))
    layer.appendChild(verticalLine(xAfter, yTop, yBottom, style.lineClass, style.lineColor))
  }
}

const SELECT_STYLE: BoundaryStyle = {
  layerClass: SELECT_LAYER_CLASS,
  lineClass: SELECT_LINE_CLASS,
  lineColor: SELECT_LINE_COLOR,
}

const COMPLETE_STYLE: BoundaryStyle = {
  layerClass: COMPLETE_LAYER_CLASS,
  lineClass: COMPLETE_LINE_CLASS,
  lineColor: COMPLETE_LINE_COLOR,
}

export function updatePracticeSelectionOverlay(
  container: HTMLElement,
  index: StaffNoteIndexEntry[],
  anchorSec: number,
  currentSec: number,
): void {
  clearPracticeSelectionOverlay(container, false)
  drawSectionBoundaryLines(container, index, anchorSec, currentSec, SELECT_STYLE)
}

export function updateCompletedSectionOverlays(
  container: HTMLElement,
  index: StaffNoteIndexEntry[],
  ranges: PracticeTimeRange[],
): void {
  clearCompletedSectionOverlays(container, false)
  for (const range of ranges) {
    drawSectionBoundaryLines(container, index, range.startSec, range.lastAttackSec, COMPLETE_STYLE)
  }
}

export function clearPracticeSelectionOverlay(
  container: HTMLElement | null | undefined,
  removeLayers = true,
): void {
  if (!container) return
  for (const page of queryOsmdPageElements(container)) {
    for (const layer of page.querySelectorAll(`g.${SELECT_LAYER_CLASS}`)) {
      layer.replaceChildren()
      if (removeLayers) layer.remove()
    }
  }
}

export function clearCompletedSectionOverlays(
  container: HTMLElement | null | undefined,
  removeLayers = true,
): void {
  if (!container) return
  for (const page of queryOsmdPageElements(container)) {
    for (const layer of page.querySelectorAll(`g.${COMPLETE_LAYER_CLASS}`)) {
      layer.replaceChildren()
      if (removeLayers) layer.remove()
    }
  }
}