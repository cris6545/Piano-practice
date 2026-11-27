import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Song, PlayerMode } from '../types/song'
import { stripScoreFileExtension } from '../lib/fileImport'
import type { ChordGroup } from '../types/song'
import type { StaffHighlightState } from '../lib/osmdStaffHighlight'
import {
  chordGroupsFromSchedule,
  buildScheduleFromMidi,
  isPracticeStepComplete,
  playbackDurationSec,
} from '../engine/midiSchedule'
import { useMidi } from '../hooks/useMidi'
import { usePlaybackEngine } from '../hooks/usePlaybackEngine'
import type { PracticeTimeRange } from '../lib/osmdPracticeSelection'
import {
  isSuccessfulSectionRun,
  nominalSectionDurationSec,
  practiceSectionKey,
  PRACTICE_PASSES_REQUIRED,
  rhythmConsistencyFromAttacks,
} from '../lib/practiceSectionSession'
import {
  isPianoKeyboardCollapsed,
  PIANO_COLLAPSED_KEY,
  setPianoKeyboardCollapsed,
} from '../lib/pianoUiPrefs'
import {
  isPracticeDebugEnabled,
  logPracticeDebug,
  practiceStepsFromScheduleFallback,
  practiceStepsFromStaffIndex,
  type PracticeStep,
} from '../lib/practiceSteps'
import { SheetMusic, type SheetMusicHandle } from './SheetMusic'
import { PlayerToolbar } from './PlayerToolbar'
import { PianoKeyboard } from './PianoKeyboard'
import { PlaybackSeekBar } from './PlaybackSeekBar'
import './SongPlayer.css'

interface SongPlayerProps {
  song: Song
  onBack: () => void
}

function songDisplayTitle(song: Song): string {
  return stripScoreFileExtension(song.originalFileName)
}

function flattenMatchedCounts(counts: Map<number, number>): number[] {
  const out: number[] = []
  for (const [midi, n] of counts) {
    for (let i = 0; i < n; i++) out.push(midi)
  }
  return out.sort((a, b) => a - b)
}

function formatDurationMmSs(sec: number): string {
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function chordGroupForStep(step: PracticeStep): ChordGroup {
  return {
    startSec: step.startSec,
    durationSec: step.durationSec,
    midis: [...new Set(step.midis)].sort((a, b) => a - b),
  }
}

export function SongPlayer({ song, onBack }: SongPlayerProps) {
  const [mode, setMode] = useState<PlayerMode>('idle')
  const [highlightKeys, setHighlightKeys] = useState<Set<number>>(() => new Set())
  const [practiceStepIndex, setPracticeStepIndex] = useState(0)
  const [practiceSteps, setPracticeSteps] = useState<PracticeStep[]>([])
  const [practiceMatched, setPracticeMatched] = useState<number[]>([])
  const [practiceWrongOverlayMidis, setPracticeWrongOverlayMidis] = useState<number[]>([])
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubSec, setScrubSec] = useState(0)
  const [practiceBounds, setPracticeBounds] = useState<PracticeTimeRange | null>(null)
  const [sectionPreview, setSectionPreview] = useState(false)
  const [completedSections, setCompletedSections] = useState<PracticeTimeRange[]>([])
  const [staffFlashMessage, setStaffFlashMessage] = useState<string | null>(null)
  const [practiceDebug, setPracticeDebug] = useState(() => isPracticeDebugEnabled())
  const [pianoCollapsed, setPianoCollapsed] = useState(() => isPianoKeyboardCollapsed())
  const sessionPassCountsRef = useRef<Record<string, number>>({})
  const staffFlashTimerRef = useRef(0)
  const sectionPreviewGenRef = useRef(0)
  const sheetMusicRef = useRef<SheetMusicHandle>(null)
  const modeRef = useRef<PlayerMode>('idle')
  const matchedRef = useRef<Map<number, number>>(new Map())
  const practiceBoundsRef = useRef<PracticeTimeRange | null>(null)
  const practiceRunRef = useRef<{
    rangeKey: string
    startedAtMs: number | null
    hadWrongKey: boolean
    stepAttackMs: number[]
  } | null>(null)
  const hadWrongKeyRef = useRef(false)
  const practiceStepIndexRef = useRef(0)
  const practiceStepsRef = useRef<PracticeStep[]>([])
  const mustReleaseRef = useRef<Set<number>>(new Set())
  const activeNotesRef = useRef<Set<number>>(new Set())
  const scheduleRef = useRef(scheduleFromSong(song))
  practiceBoundsRef.current = practiceBounds
  practiceStepIndexRef.current = practiceStepIndex
  practiceStepsRef.current = practiceSteps

  function scheduleFromSong(s: Song) {
    if (s.schedule?.length) return s.schedule
    if (s.sourceType === 'mid' && s.originalData?.byteLength) {
      return buildScheduleFromMidi(s.originalData)
    }
    return s.schedule ?? []
  }

  const schedule = useMemo(() => scheduleFromSong(song), [song])
  scheduleRef.current = schedule

  const chordGroups = useMemo(() => chordGroupsFromSchedule(schedule), [schedule])
  const durationSec = useMemo(() => playbackDurationSec(schedule), [schedule])
  const playback = usePlaybackEngine(schedule)

  modeRef.current = mode

  const loadPracticeSteps = useCallback((range: PracticeTimeRange) => {
    const staffIndex = sheetMusicRef.current?.getNoteIndex() ?? []
    let steps =
      staffIndex.length > 0
        ? practiceStepsFromStaffIndex(staffIndex, range.startSec, range.lastAttackSec)
        : []
    if (!steps.length) {
      steps = practiceStepsFromScheduleFallback(
        scheduleRef.current,
        range.startSec,
        range.lastAttackSec,
      )
    }
    practiceStepsRef.current = steps
    setPracticeSteps(steps)
    logPracticeDebug('section steps (staff-aligned)', {
      stepCount: steps.length,
      steps: steps.map((s, i) => ({
        i,
        startSec: Number(s.startSec.toFixed(4)),
        midis: s.midis,
      })),
      staffNoteCount: staffIndex.length,
      scheduleNotesInRange: scheduleRef.current.filter(
        (n) => n.startSec >= range.startSec && n.startSec <= range.lastAttackSec,
      ).length,
    })
    return steps
  }, [])

  const syncStepHighlights = useCallback((stepIndex: number) => {
    const step = practiceStepsRef.current[stepIndex]
    if (!step) {
      setHighlightKeys(new Set())
      return
    }
    setHighlightKeys(new Set(step.midis))
  }, [])

  const markWrongKey = useCallback(() => {
    hadWrongKeyRef.current = true
    if (practiceRunRef.current) practiceRunRef.current.hadWrongKey = true
  }, [])

  const beginPracticeRun = useCallback((range: PracticeTimeRange) => {
    hadWrongKeyRef.current = false
    practiceRunRef.current = {
      rangeKey: practiceSectionKey(range),
      startedAtMs: null,
      hadWrongKey: false,
      stepAttackMs: [],
    }
  }, [])

  const showStaffFlash = useCallback((message: string) => {
    if (staffFlashTimerRef.current) window.clearTimeout(staffFlashTimerRef.current)
    setStaffFlashMessage(message)
    staffFlashTimerRef.current = window.setTimeout(() => {
      staffFlashTimerRef.current = 0
      setStaffFlashMessage(null)
    }, 2200)
  }, [])

  const restartPracticeSection = useCallback(() => {
    const bounds = practiceBoundsRef.current
    if (!bounds) return
    loadPracticeSteps(bounds)
    matchedRef.current.clear()
    setPracticeMatched([])
    mustReleaseRef.current.clear()
    setPracticeWrongOverlayMidis([])
    practiceStepIndexRef.current = 0
    setPracticeStepIndex(0)
    beginPracticeRun(bounds)
    syncStepHighlights(0)
  }, [beginPracticeRun, loadPracticeSteps, syncStepHighlights])

  const registerSectionAttempt = useCallback(
    (range: PracticeTimeRange): { ok: boolean; mastered: boolean } => {
      const run = practiceRunRef.current
      const wrongKey = hadWrongKeyRef.current || (run?.hadWrongKey ?? false)
      practiceRunRef.current = null
      hadWrongKeyRef.current = false

      if (!run || run.rangeKey !== practiceSectionKey(range) || run.startedAtMs == null) {
        return { ok: false, mastered: false }
      }

      const elapsedSec = (performance.now() - run.startedAtMs) / 1000
      const nominal = nominalSectionDurationSec(range)
      const steps = practiceStepsRef.current
      const rhythmConsistency = rhythmConsistencyFromAttacks(steps, run.stepAttackMs)
      logPracticeDebug('section attempt', {
        elapsedSec,
        nominalSec: nominal,
        rhythmConsistency,
        attacks: run.stepAttackMs.length,
      })
      if (!isSuccessfulSectionRun(elapsedSec, nominal, wrongKey, rhythmConsistency)) {
        return { ok: false, mastered: false }
      }

      const key = practiceSectionKey(range)
      const passes = (sessionPassCountsRef.current[key] ?? 0) + 1
      sessionPassCountsRef.current[key] = passes

      if (passes >= PRACTICE_PASSES_REQUIRED) {
        setCompletedSections((sections) =>
          sections.some((s) => practiceSectionKey(s) === key) ? sections : [...sections, range],
        )
      }
      return { ok: true, mastered: passes >= PRACTICE_PASSES_REQUIRED }
    },
    [],
  )

  const armMustReleaseForNextStep = useCallback((nextStep: PracticeStep | undefined) => {
    mustReleaseRef.current.clear()
    if (!nextStep) return
    const held = activeNotesRef.current
    for (const midi of nextStep.midis) {
      if (held.has(midi)) mustReleaseRef.current.add(midi)
    }
    if (mustReleaseRef.current.size) {
      logPracticeDebug('awaiting release before next attack', [...mustReleaseRef.current])
    }
  }, [])

  const timelineSec = mode === 'playback' ? playback.positionSec : scrubSec

  useEffect(() => {
    if (mode === 'practice' && !scrubbing) return
    if (mode === 'idle' && !scrubbing && scrubSec <= 0) {
      setHighlightKeys(new Set())
      return
    }
    const active = new Set<number>()
    const t = mode === 'playback' ? playback.positionSec : scrubSec
    for (const n of schedule) {
      if (t >= n.startSec && t < n.startSec + n.durationSec) {
        active.add(n.midi)
      }
    }
    setHighlightKeys(active)
  }, [mode, scrubbing, playback.positionSec, scrubSec, schedule])

  const handleSeek = useCallback(
    (sec: number) => {
      const clamped = Math.max(0, Math.min(sec, durationSec))
      if (mode === 'playback') {
        playback.seek(clamped)
      } else {
        setScrubSec(clamped)
      }
    },
    [durationSec, mode, playback],
  )

  const handleMidi = useCallback(
    (event: { midi: number; type: 'on' | 'off' }) => {
      if (modeRef.current !== 'practice') return
      if (!practiceBoundsRef.current) return

      if (event.type === 'off') {
        mustReleaseRef.current.delete(event.midi)
        setPracticeWrongOverlayMidis((prev) =>
          prev.includes(event.midi) ? prev.filter((m) => m !== event.midi) : prev,
        )
        return
      }

      const idx = practiceStepIndexRef.current
      const steps = practiceStepsRef.current
      const step = steps[idx]
      if (!step) return

      if (mustReleaseRef.current.has(event.midi)) {
        logPracticeDebug('ignored held key (release first)', { midi: event.midi, step: idx })
        return
      }

      const required = step.midis
      if (!required.includes(event.midi)) {
        markWrongKey()
        setPracticeWrongOverlayMidis((prev) =>
          prev.includes(event.midi) ? prev : [...prev, event.midi],
        )
        logPracticeDebug('wrong key', { midi: event.midi, step: idx, required })
        return
      }

      const run = practiceRunRef.current
      const attackMs = performance.now()
      if (run && run.startedAtMs == null) {
        run.startedAtMs = attackMs
      }
      if (run && run.stepAttackMs[idx] == null) {
        run.stepAttackMs[idx] = attackMs
      }

      matchedRef.current.set(event.midi, (matchedRef.current.get(event.midi) ?? 0) + 1)
      const matchedMidiList = flattenMatchedCounts(matchedRef.current)
      setPracticeMatched(matchedMidiList)

      logPracticeDebug('key accepted', {
        midi: event.midi,
        step: idx,
        required,
        matched: matchedMidiList,
      })

      if (isPracticeStepComplete(required, matchedMidiList)) {
        matchedRef.current.clear()
        setPracticeMatched([])
        const next = idx + 1
        const pastSection = next >= steps.length

        if (pastSection) {
          const bounds = practiceBoundsRef.current
          if (bounds) {
            const { ok, mastered } = registerSectionAttempt(bounds)
            showStaffFlash(ok ? 'Well done!' : 'Again!')
            if (ok && mastered) {
              matchedRef.current.clear()
              setPracticeMatched([])
              setPracticeWrongOverlayMidis([])
              setHighlightKeys(new Set())
              setPracticeBounds(null)
              setPracticeSteps([])
              practiceStepsRef.current = []
              practiceRunRef.current = null
              mustReleaseRef.current.clear()
              setMode('practice-select')
            } else {
              restartPracticeSection()
            }
          } else {
            setMode('idle')
            setHighlightKeys(new Set())
            setPracticeBounds(null)
          }
          return
        }

        const nextStep = steps[next]
        setPracticeWrongOverlayMidis([])
        practiceStepIndexRef.current = next
        armMustReleaseForNextStep(nextStep)
        setPracticeStepIndex(next)
        syncStepHighlights(next)
        return
      }
    },
    [
      armMustReleaseForNextStep,
      markWrongKey,
      registerSectionAttempt,
      restartPracticeSection,
      showStaffFlash,
      syncStepHighlights,
    ],
  )

  const { connected, deviceName, activeNotes } = useMidi(handleMidi)
  activeNotesRef.current = activeNotes

  const staffHighlight = useMemo((): StaffHighlightState | null => {
    if (sectionPreview || (mode === 'playback' && practiceBounds != null)) {
      return { kind: 'playback', timeSec: playback.positionSec }
    }
    if (mode === 'practice-select') {
      return null
    }
    if (mode === 'practice' && !scrubbing) {
      const step = practiceSteps[practiceStepIndex]
      if (!step) return null
      return {
        kind: 'practice',
        group: chordGroupForStep(step),
        requiredMidis: step.midis,
        matchedMidis: practiceMatched,
        wrongPressOverlayMidis: practiceWrongOverlayMidis,
      }
    }
    if (mode === 'playback' || scrubbing || scrubSec > 0) {
      return { kind: 'playback', timeSec: timelineSec }
    }
    if (activeNotes.size > 0) {
      return { kind: 'idle' }
    }
    return null
  }, [
    mode,
    scrubbing,
    timelineSec,
    playback.positionSec,
    playback.playing,
    practiceStepIndex,
    practiceSteps,
    practiceMatched,
    practiceWrongOverlayMidis,
    practiceBounds,
    sectionPreview,
    activeNotes.size,
  ])

  const debugStep = practiceSteps[practiceStepIndex]

  const playSectionThenPractice = useCallback(
    (range: PracticeTimeRange) => {
      const gen = ++sectionPreviewGenRef.current
      setPracticeBounds(range)
      matchedRef.current.clear()
      setPracticeMatched([])
      setPracticeWrongOverlayMidis([])
      mustReleaseRef.current.clear()
      hadWrongKeyRef.current = false
      practiceRunRef.current = null
      setStaffFlashMessage(null)
      if (staffFlashTimerRef.current) {
        window.clearTimeout(staffFlashTimerRef.current)
        staffFlashTimerRef.current = 0
      }
      setSectionPreview(true)
      modeRef.current = 'playback'
      setMode('playback')
      if (!playback.playing) playback.seek(range.startSec)

      const nextAfterSelection = chordGroups.find(
        (g) => g.startSec > range.lastAttackSec + 0.001,
      )
      const previewEndSec = nextAfterSelection
        ? Math.min(range.endSec, nextAfterSelection.startSec)
        : range.endSec

      void playback.playRange(range.startSec, previewEndSec, () => {
        if (gen !== sectionPreviewGenRef.current) return
        setSectionPreview(false)
        const steps = loadPracticeSteps(range)
        practiceStepIndexRef.current = 0
        setPracticeStepIndex(0)
        beginPracticeRun(range)
        modeRef.current = 'practice'
        setMode('practice')
        if (steps.length) syncStepHighlights(0)
      })
    },
    [beginPracticeRun, chordGroups, loadPracticeSteps, playback, syncStepHighlights],
  )

  const handleRestart = useCallback(() => {
    const current = modeRef.current
    if (current === 'practice-select') return
    if (current === 'practice' || sectionPreview) {
      const bounds = practiceBoundsRef.current
      if (!bounds) return
      playSectionThenPractice(bounds)
      return
    }
    setSectionPreview(false)
    modeRef.current = 'playback'
    setMode('playback')
    void playback.restart()
  }, [playSectionThenPractice, playback, sectionPreview])

  const startPractice = useCallback(() => {
    sectionPreviewGenRef.current += 1
    playback.stop()
    setPracticeBounds(null)
    setPracticeSteps([])
    practiceStepsRef.current = []
    setSectionPreview(false)
    matchedRef.current.clear()
    setPracticeMatched([])
    setPracticeWrongOverlayMidis([])
    setStaffFlashMessage(null)
    if (staffFlashTimerRef.current) {
      window.clearTimeout(staffFlashTimerRef.current)
      staffFlashTimerRef.current = 0
    }
    hadWrongKeyRef.current = false
    practiceRunRef.current = null
    mustReleaseRef.current.clear()
    setMode('practice-select')
  }, [playback])

  const handlePracticeRangePicked = useCallback(
    (range: PracticeTimeRange) => {
      const label = `${formatDurationMmSs(range.startSec)} – ${formatDurationMmSs(range.endSec)}`
      const ok = window.confirm(`Practice this section (${label})?\n\nThe selection will play once, then practice begins.`)
      if (!ok) {
        setMode('practice-select')
        return
      }

      playSectionThenPractice(range)
    },
    [playSectionThenPractice],
  )

  const startPlay = useCallback(() => {
    sectionPreviewGenRef.current += 1
    setSectionPreview(false)
    modeRef.current = 'playback'
    setMode('playback')
    matchedRef.current.clear()
    setPracticeMatched([])
    if (playback.playing) {
      void playback.resume()
      return
    }
    if (mode === 'idle' && scrubSec > 0) playback.seek(scrubSec)
    void playback.play()
  }, [playback, mode, scrubSec])

  const stopMode = useCallback(() => {
    sectionPreviewGenRef.current += 1
    playback.stop()
    setMode('idle')
    matchedRef.current.clear()
    setPracticeMatched([])
    setPracticeWrongOverlayMidis([])
    setPracticeBounds(null)
    setPracticeSteps([])
    practiceStepsRef.current = []
    setSectionPreview(false)
    setScrubSec(0)
    setHighlightKeys(new Set())
    setStaffFlashMessage(null)
    if (staffFlashTimerRef.current) {
      window.clearTimeout(staffFlashTimerRef.current)
      staffFlashTimerRef.current = 0
    }
    hadWrongKeyRef.current = false
    practiceRunRef.current = null
    mustReleaseRef.current.clear()
  }, [playback])

  useEffect(() => {
    return () => playback.stop()
  }, [song.id, playback.stop])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'pst-practice-debug') setPracticeDebug(isPracticeDebugEnabled())
      if (e.key === PIANO_COLLAPSED_KEY) setPianoCollapsed(isPianoKeyboardCollapsed())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <div className="song-player">
      <PlayerToolbar
        mode={mode}
        playing={playback.playing}
        midiConnected={connected}
        midiLabel={deviceName}
        onBack={onBack}
        onPractice={startPractice}
        onPlay={startPlay}
        onPause={() => playback.pause()}
        onRestart={handleRestart}
        onStopMode={stopMode}
      />

      <div className="player-title">
        <h2>{songDisplayTitle(song)}</h2>
        {playback.pianoError && <p className="library-error">{playback.pianoError}</p>}
        {playback.pianoLoading && <p className="mid-hint">Loading grand piano samples…</p>}
        {mode === 'practice-select' && (
          <p className="mid-hint">Drag on the staff to select a section to practice.</p>
        )}
        {sectionPreview && practiceBounds && (
          <p className="mid-hint">Playing selected section…</p>
        )}
        {practiceDebug && mode === 'practice' && (
          <details className="practice-debug" open>
            <summary>Practice debug</summary>
            <p>
              Step {practiceStepIndex + 1}/{practiceSteps.length}
              {debugStep && (
                <>
                  {' '}
                  · t={debugStep.startSec.toFixed(3)}s · need [{debugStep.midis.join(', ')}]
                </>
              )}
            </p>
            <p className="mid-hint">
              Console: localStorage.setItem(&apos;pst-practice-debug&apos;, &apos;0&apos;) to hide.
              Each key logs as [practice].
            </p>
          </details>
        )}
        {!playback.pianoLoading && !playback.pianoError && durationSec > 0 && (
          <PlaybackSeekBar
            positionSec={timelineSec}
            durationSec={durationSec}
            formatTime={formatDurationMmSs}
            onSeek={handleSeek}
            onScrubStart={() => setScrubbing(true)}
            onScrubEnd={() => setScrubbing(false)}
          />
        )}
      </div>

      <div className="sheet-scroll">
        <SheetMusic
          ref={sheetMusicRef}
          musicXml={song.musicXml}
          schedule={schedule}
          staffHighlight={staffHighlight}
          midiPressed={activeNotes}
          practiceSelecting={mode === 'practice-select'}
          completedPracticeSections={completedSections}
          onPracticeRangePicked={handlePracticeRangePicked}
          userScrollLocked={playback.playing}
        />
        {staffFlashMessage && (
          <p className="staff-flash" role="status" aria-live="polite">
            {staffFlashMessage}
          </p>
        )}
      </div>

      <div className="piano-panel">
        <button
          type="button"
          className="piano-collapse-toggle"
          onClick={() =>
            setPianoCollapsed((c) => {
              const next = !c
              setPianoKeyboardCollapsed(next)
              return next
            })
          }
          aria-expanded={!pianoCollapsed}
          aria-controls="song-piano-keyboard"
          title={pianoCollapsed ? 'Show piano' : 'Hide piano'}
        >
          <span
            className={`piano-collapse-arrow${pianoCollapsed ? ' collapsed' : ''}`}
            aria-hidden
          >
            ▼
          </span>
        </button>
        {!pianoCollapsed && (
          <PianoKeyboard id="song-piano-keyboard" highlight={highlightKeys} pressed={activeNotes} />
        )}
      </div>
    </div>
  )
}