import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { OSMD_CONSTRUCTOR_OPTIONS, prepareOsmdBeforeRender } from '../lib/osmdSheetOptions'
import {
  buildStaffNoteIndex,
  updateStaffHighlight,
  type StaffHighlightState,
  type StaffNoteIndexEntry,
} from '../lib/osmdStaffHighlight'
import { clearStaffGeometryCache } from '../lib/osmdStaffGeometry'
import { updateMidiSemibreveOverlay } from '../lib/osmdMidiSemibreve'
import { arrangeOsmdPagesInRow } from '../lib/osmdHorizontalPages'
import {
  clearCompletedSectionOverlays,
  clearPracticeSelectionOverlay,
  pointerOnGrandStaff,
  practiceRangeFromTimes,
  timeAtPointer,
  updateCompletedSectionOverlays,
  updatePracticeSelectionOverlay,
  type PracticeTimeRange,
} from '../lib/osmdPracticeSelection'
import { buildPageLayouts, type PageLayout } from '../lib/osmdPlaybackScroll'
import { setUserSheetScrollLocked } from '../lib/osmdUserScrollLock'
import type { ScheduledNote } from '../types/song'
import './SheetMusic.css'

export interface SheetMusicHandle {
  getOsmd: () => OpenSheetMusicDisplay | null
  getNoteIndex: () => StaffNoteIndexEntry[]
}

interface SheetMusicProps {
  musicXml: string
  schedule: ScheduledNote[]
  staffHighlight?: StaffHighlightState | null
  midiPressed?: Set<number>
  practiceSelecting?: boolean
  completedPracticeSections?: PracticeTimeRange[]
  onPracticeRangePicked?: (range: PracticeTimeRange) => void
  onReady?: (osmd: OpenSheetMusicDisplay) => void
  /** While playback is running, block manual sheet page scrolling. */
  userScrollLocked?: boolean
}

const WIDTH_EPS_PX = 2
const RESIZE_DEBOUNCE_MS = 48

function svgHasPrimitives(host: HTMLElement | null): boolean {
  const svg =
    host?.querySelector('#osmdSvgPage1') ??
    host?.querySelector('[id^="osmdSvgPage"]')
  if (!svg) return false
  return svg.querySelectorAll('line,path,rect,circle,text,polyline,polygon,use').length > 0
}

function scheduleSignature(schedule: ScheduledNote[]): string {
  if (!schedule.length) return 'empty'
  const first = schedule[0]
  const last = schedule[schedule.length - 1]
  return `${schedule.length}:${first.startSec}:${first.midi}:${last.startSec}:${last.midi}`
}

function completedSectionsSignature(ranges: PracticeTimeRange[] | undefined): string {
  if (!ranges?.length) return 'none'
  return ranges.map((r) => `${r.startSec}:${r.lastAttackSec}`).join('|')
}

function highlightSignature(state: StaffHighlightState | null | undefined): string {
  if (!state) return 'none'
  if (state.kind === 'practice') {
    const wrong = [...(state.wrongPressOverlayMidis ?? [])].sort((a, b) => a - b).join('.')
    return `practice:${state.group.startSec}:${state.requiredMidis.join('.')}:${state.matchedMidis.join('.')}:${wrong}`
  }
  if (state.kind === 'playback') {
    return `playback:${state.timeSec.toFixed(2)}`
  }
  return 'idle'
}

export const SheetMusic = forwardRef<SheetMusicHandle, SheetMusicProps>(function SheetMusic(
  {
    musicXml,
    schedule,
    staffHighlight,
    midiPressed,
    practiceSelecting,
    completedPracticeSections,
    onPracticeRangePicked,
    onReady,
    userScrollLocked,
  },
  ref,
) {
  const mountGenRef = useRef(0)
  const measureRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const noteIndexRef = useRef<StaffNoteIndexEntry[]>([])
  const pageLayoutsRef = useRef<PageLayout[]>([])
  const lastRenderedWidthRef = useRef(-1)
  const scheduleRef = useRef(schedule)
  const onReadyRef = useRef(onReady)
  const staffHighlightRef = useRef(staffHighlight)
  const midiPressedRef = useRef(midiPressed)
  const practiceSelectingRef = useRef(practiceSelecting)
  const completedSectionsRef = useRef(completedPracticeSections)
  const onPracticeRangePickedRef = useRef(onPracticeRangePicked)
  const dragAnchorSecRef = useRef<number | null>(null)
  scheduleRef.current = schedule
  onReadyRef.current = onReady
  staffHighlightRef.current = staffHighlight
  midiPressedRef.current = midiPressed
  practiceSelectingRef.current = practiceSelecting
  completedSectionsRef.current = completedPracticeSections
  onPracticeRangePickedRef.current = onPracticeRangePicked

  const scheduleSig = scheduleSignature(schedule)
  const staffHighlightSig = highlightSignature(staffHighlight)
  const completedSectionsSig = completedSectionsSignature(completedPracticeSections)
  const midiPressedSig = [...(midiPressed ?? [])].sort((a, b) => a - b).join(',')

  useImperativeHandle(ref, () => ({
    getOsmd: () => osmdRef.current,
    getNoteIndex: () => noteIndexRef.current,
  }))

  useEffect(() => {
    const mountId = ++mountGenRef.current
    const scrollEl = containerRef.current
    const measureEl = measureRef.current
    if (!scrollEl || !measureEl) return

    let cancelled = false
    let osmd: OpenSheetMusicDisplay | null = null
    let resizeObserver: ResizeObserver | undefined
    let resizeRaf = 0
    let resizeDebounceTimer = 0
    let renderInFlight = false
    let renderPending = false

    const isMounted = () =>
      !cancelled && mountGenRef.current === mountId && scrollEl.isConnected && measureEl.isConnected

    const renderScore = () => {
      if (!isMounted() || !osmd) return

      if (renderInFlight) {
        renderPending = true
        return
      }

      const host = containerRef.current
      const layoutWidth = measureRef.current?.clientWidth ?? 0
      if (!host || layoutWidth < 10 || host.clientHeight < 10) {
        cancelAnimationFrame(resizeRaf)
        resizeRaf = requestAnimationFrame(() => {
          if (isMounted()) renderScore()
        })
        return
      }

      const widthDelta = Math.abs(layoutWidth - lastRenderedWidthRef.current)
      const hasContent = svgHasPrimitives(host)
      if (lastRenderedWidthRef.current >= 0 && widthDelta < WIDTH_EPS_PX && hasContent) {
        return
      }

      if (!prepareOsmdBeforeRender(osmd, host, layoutWidth, musicXml)) return

      renderInFlight = true
      try {
        osmd.render()
        arrangeOsmdPagesInRow(host, layoutWidth)
        noteIndexRef.current = buildStaffNoteIndex(osmd, scheduleRef.current)
        clearStaffGeometryCache()
        pageLayoutsRef.current = buildPageLayouts(host, noteIndexRef.current, layoutWidth)
        updateStaffHighlight(
          osmd,
          noteIndexRef.current,
          staffHighlightRef.current,
          host,
          pageLayoutsRef.current,
          midiPressedRef.current,
        )
        updateMidiSemibreveOverlay(
          osmd,
          host,
          noteIndexRef.current,
          staffHighlightRef.current,
          midiPressedRef.current,
        )
        const completed = completedSectionsRef.current
        if (completed?.length) {
          updateCompletedSectionOverlays(host, noteIndexRef.current, completed)
        } else {
          clearCompletedSectionOverlays(host)
        }
        lastRenderedWidthRef.current = layoutWidth
        onReadyRef.current?.(osmd)
      } finally {
        renderInFlight = false
        if (renderPending) {
          renderPending = false
          scheduleRenderScore()
        }
      }
    }

    const scheduleRenderScore = () => {
      if (!isMounted()) return
      if (resizeDebounceTimer) window.clearTimeout(resizeDebounceTimer)
      resizeDebounceTimer = window.setTimeout(() => {
        resizeDebounceTimer = 0
        if (isMounted()) renderScore()
      }, RESIZE_DEBOUNCE_MS)
    }

    osmd = new OpenSheetMusicDisplay(scrollEl, OSMD_CONSTRUCTOR_OPTIONS)
    osmdRef.current = osmd

    void osmd.load(musicXml).then(() => {
      if (!isMounted()) return
      renderScore()
      if (!isMounted()) return

      resizeObserver = new ResizeObserver((entries) => {
        if (!isMounted()) return
        const w = Math.round(entries[0]?.contentRect.width ?? measureEl.clientWidth)
        const host = containerRef.current
        if (
          lastRenderedWidthRef.current >= 0 &&
          Math.abs(w - lastRenderedWidthRef.current) < WIDTH_EPS_PX &&
          svgHasPrimitives(host)
        ) {
          return
        }
        scheduleRenderScore()
      })
      resizeObserver.observe(measureEl)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(resizeRaf)
      if (resizeDebounceTimer) window.clearTimeout(resizeDebounceTimer)
      resizeObserver?.disconnect()
      resizeObserver = undefined
      lastRenderedWidthRef.current = -1
      pageLayoutsRef.current = []
      noteIndexRef.current = []
      if (osmd) {
        try {
          osmd.clear()
        } catch {
          /* ignore */
        }
        try {
          osmd.destroy()
        } catch {
          /* ignore */
        }
      }
      if (mountGenRef.current === mountId) {
        osmdRef.current = null
      }
    }
  }, [musicXml, scheduleSig])

  useEffect(() => {
    const osmd = osmdRef.current
    const el = containerRef.current
    if (!osmd || !el || !noteIndexRef.current.length) return
    updateStaffHighlight(
      osmd,
      noteIndexRef.current,
      staffHighlight,
      el,
      pageLayoutsRef.current,
      midiPressed,
    )
  }, [staffHighlightSig, midiPressedSig])

  useEffect(() => {
    const osmd = osmdRef.current
    const el = containerRef.current
    if (!osmd || !el || !noteIndexRef.current.length) return
    updateMidiSemibreveOverlay(osmd, el, noteIndexRef.current, staffHighlight, midiPressed)
  }, [staffHighlightSig, midiPressedSig])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !noteIndexRef.current.length) return
    const completed = completedPracticeSections
    if (completed?.length) {
      updateCompletedSectionOverlays(el, noteIndexRef.current, completed)
    } else {
      clearCompletedSectionOverlays(el)
    }
  }, [completedSectionsSig])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setUserSheetScrollLocked(el, userScrollLocked === true)
    return () => setUserSheetScrollLocked(el, false)
  }, [userScrollLocked])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (practiceSelecting) {
      el.classList.add('sheet-osmd--practice-select')
    } else {
      el.classList.remove('sheet-osmd--practice-select')
      dragAnchorSecRef.current = null
      clearPracticeSelectionOverlay(el)
    }
  }, [practiceSelecting])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !practiceSelecting) return

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !practiceSelectingRef.current) return
      if (!pointerOnGrandStaff(el, e.clientX, e.clientY)) return
      const t = timeAtPointer(el, noteIndexRef.current, e.clientX)
      if (t == null) return
      dragAnchorSecRef.current = t
      el.setPointerCapture(e.pointerId)
      e.preventDefault()
      updatePracticeSelectionOverlay(el, noteIndexRef.current, t, t)
    }

    const onPointerMove = (e: PointerEvent) => {
      const anchor = dragAnchorSecRef.current
      if (anchor == null) return
      const t = timeAtPointer(el, noteIndexRef.current, e.clientX)
      if (t == null) return
      updatePracticeSelectionOverlay(el, noteIndexRef.current, anchor, t)
    }

    const finishDrag = (e: PointerEvent) => {
      const anchor = dragAnchorSecRef.current
      if (anchor == null) return
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      const t = timeAtPointer(el, noteIndexRef.current, e.clientX) ?? anchor
      clearPracticeSelectionOverlay(el)
      dragAnchorSecRef.current = null
      const range = practiceRangeFromTimes(noteIndexRef.current, anchor, t)
      if (range) onPracticeRangePickedRef.current?.(range)
    }

    const onPointerUp = (e: PointerEvent) => finishDrag(e)
    const onPointerCancel = (e: PointerEvent) => finishDrag(e)

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [practiceSelecting])

  return (
    <div ref={measureRef} className="sheet-osmd-measure">
      <div ref={containerRef} className="sheet-osmd" />
    </div>
  )
})