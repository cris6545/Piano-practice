import type { StaffNoteIndexEntry } from './osmdStaffHighlight'
import { chordGroupsFromSchedule } from '../engine/midiSchedule'
import type { ChordGroup } from '../types/song'
import { arrangeOsmdPagesInRow, queryOsmdPageElements } from './osmdHorizontalPages'
import { programmaticSheetScroll } from './osmdUserScrollLock'

const TIME_EPS = 0.003
const SCROLL_ALIGN_EPS_PX = 6

export interface PageLayout {
  pageIndex: number
  left: number
  width: number
}

let snappedForGroupIndex = -1
let shownPageIndex = -1

export function resetPlaybackScrollMotion(): void {
  snappedForGroupIndex = -1
  shownPageIndex = -1
}

function buildPageLayoutsFromDom(container: HTMLElement, pageWidthPx: number): PageLayout[] {
  const pages = queryOsmdPageElements(container)
  if (!pages.length) return []

  const pageWidth = Math.max(200, Math.round(pageWidthPx))
  let left = 0
  return pages.map((el, i) => {
    const width = el.offsetWidth > 0 ? el.offsetWidth : pageWidth
    const layout: PageLayout = { pageIndex: i, left, width }
    left += width
    return layout
  })
}

function buildPageLayoutsFromNotes(
  container: HTMLElement,
  index: StaffNoteIndexEntry[],
): PageLayout[] {
  const cRect = container.getBoundingClientRect()
  const savedScrollLeft = container.scrollLeft
  const pageIndices = [...new Set(index.map((e) => e.pageIndex ?? 0))].sort((a, b) => a - b)
  const layouts: PageLayout[] = []

  for (const pageIndex of pageIndices) {
    const notes = index.filter((e) => (e.pageIndex ?? 0) === pageIndex)
    let left = Infinity
    let right = -Infinity

    for (const n of notes) {
      const g = n.graphicalNote.getSVGGElement?.()
      if (!g) continue
      const r = g.getBoundingClientRect()
      left = Math.min(left, r.left - cRect.left + savedScrollLeft)
      right = Math.max(right, r.right - cRect.left + savedScrollLeft)
    }

    if (!Number.isFinite(left)) continue
    layouts.push({
      pageIndex,
      left: Math.max(0, left),
      width: Math.max(120, right - left),
    })
  }

  layouts.sort((a, b) => a.left - b.left)
  return layouts
}

export function buildPageLayouts(
  container: HTMLElement,
  index: StaffNoteIndexEntry[],
  pageWidthPx: number,
): PageLayout[] {
  const savedTop = container.scrollTop
  const savedLeft = container.scrollLeft
  container.scrollTop = 0
  container.scrollLeft = 0

  arrangeOsmdPagesInRow(container, pageWidthPx)
  let layouts = buildPageLayoutsFromDom(container, pageWidthPx)
  if (!layouts.length) {
    layouts = buildPageLayoutsFromNotes(container, index)
  }

  container.scrollTop = savedTop
  container.scrollLeft = savedLeft
  resetPlaybackScrollMotion()
  return layouts
}

function noteScreenRect(entry: StaffNoteIndexEntry): DOMRect | null {
  const g = entry.graphicalNote.getSVGGElement?.()
  return g?.getBoundingClientRect() ?? null
}

function notesForGroup(index: StaffNoteIndexEntry[], group: ChordGroup): StaffNoteIndexEntry[] {
  return index.filter((e) => Math.abs(e.startSec - group.startSec) < TIME_EPS)
}

/** Page snap care about horizontal fit; short page height can clip vertically. */
function isHorizontallyVisible(rect: DOMRect, container: HTMLElement): boolean {
  const c = container.getBoundingClientRect()
  return rect.left >= c.left - 1 && rect.right <= c.right + 1
}

function playingGroupIndex(groups: ChordGroup[], timeSec: number): number {
  let idx = -1
  for (let g = 0; g < groups.length; g++) {
    const gr = groups[g]
    if (timeSec + TIME_EPS >= gr.startSec && timeSec < gr.startSec + gr.durationSec) {
      return g
    }
    if (gr.startSec <= timeSec) idx = g
  }
  return idx
}

function contentXForGroup(
  container: HTMLElement,
  index: StaffNoteIndexEntry[],
  group: ChordGroup,
): number | null {
  const notes = notesForGroup(index, group)
  const cRect = container.getBoundingClientRect()
  let sum = 0
  let count = 0

  for (const n of notes) {
    const r = noteScreenRect(n)
    if (!r) continue
    sum += r.left - cRect.left + container.scrollLeft + r.width / 2
    count++
  }

  return count > 0 ? sum / count : null
}

/** Which horizontal page (DOM order) contains this chord — not OSMD's page number alone. */
function pageIndexForGroup(
  container: HTMLElement,
  index: StaffNoteIndexEntry[],
  layouts: PageLayout[],
  group: ChordGroup,
): number {
  if (!layouts.length) return 0

  const x = contentXForGroup(container, index, group)
  if (x == null) return shownPageIndex >= 0 ? shownPageIndex : 0

  for (const l of layouts) {
    if (x >= l.left - 2 && x < l.left + l.width + 2) {
      return l.pageIndex
    }
  }

  let best = layouts[0].pageIndex
  let bestDist = Infinity
  for (const l of layouts) {
    const center = l.left + l.width / 2
    const d = Math.abs(x - center)
    if (d < bestDist) {
      bestDist = d
      best = l.pageIndex
    }
  }
  return best
}

function scrollAlignedToPage(
  container: HTMLElement,
  layouts: PageLayout[],
  pageIndex: number,
): boolean {
  const layout = layouts.find((l) => l.pageIndex === pageIndex)
  if (!layout) return false
  return Math.abs(container.scrollLeft - layout.left) <= SCROLL_ALIGN_EPS_PX
}

function snapToPage(container: HTMLElement, layouts: PageLayout[], pageIndex: number): void {
  const layout = layouts.find((l) => l.pageIndex === pageIndex)
  if (!layout) return
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth)
  programmaticSheetScroll(container, () => {
    container.scrollLeft = Math.max(0, Math.min(maxLeft, layout.left))
    container.scrollTop = 0
  })
  shownPageIndex = pageIndex
}

/**
 * Discrete pages in a horizontal row: keep scroll aligned with the page that contains the playing chord.
 */
export function updatePlaybackSnapScroll(
  container: HTMLElement,
  index: StaffNoteIndexEntry[],
  layouts: PageLayout[],
  timeSec: number,
): void {
  if (!index.length || !layouts.length) return

  const groups = chordGroupsFromSchedule(
    index.map((e) => ({
      midi: e.midi,
      startSec: e.startSec,
      durationSec: e.durationSec,
      velocity: 90,
    })),
  )
  if (!groups.length) return

  const playingGi = playingGroupIndex(groups, timeSec)
  if (playingGi < 0) return

  if (timeSec < 0.05 && playingGi === 0) {
    if (container.scrollLeft !== 0) {
      resetPlaybackScrollMotion()
      programmaticSheetScroll(container, () => {
        container.scrollLeft = 0
        container.scrollTop = 0
      })
    }
    return
  }

  const playingPage = pageIndexForGroup(container, index, layouts, groups[playingGi])
  const playingNotes = notesForGroup(index, groups[playingGi])
  const playingRects = playingNotes.map(noteScreenRect).filter((r): r is DOMRect => r != null)

  const onScreenHorizontally =
    playingRects.length > 0 && playingRects.every((r) => isHorizontallyVisible(r, container))
  const aligned = scrollAlignedToPage(container, layouts, playingPage)

  if (onScreenHorizontally && aligned) {
    if (snappedForGroupIndex !== playingGi) {
      snappedForGroupIndex = playingGi
      shownPageIndex = playingPage
    }
    return
  }

  if (aligned && shownPageIndex === playingPage && snappedForGroupIndex === playingGi) {
    return
  }

  snappedForGroupIndex = playingGi
  snapToPage(container, layouts, playingPage)
}