import type { StaffNoteIndexEntry } from './osmdStaffHighlight'

/** Notes at the same instant (grand-staff chord), not consecutive repeated pitches. */
export const PRACTICE_STEP_TIME_EPS = 0.001

export interface PracticeStep {
  startSec: number
  durationSec: number
  /** Duplicate midis kept — each notehead needs its own attack when listed twice. */
  midis: number[]
}

/**
 * One step per engraved notehead (staff index row). Chord tones at the same instant share one step.
 */
export function practiceStepsFromStaffIndex(
  index: StaffNoteIndexEntry[],
  startSec: number,
  /** Last included note attack time (not sounding end). */
  lastAttackSec: number,
): PracticeStep[] {
  const eps = PRACTICE_STEP_TIME_EPS
  const entries = index
    .filter((e) => e.startSec >= startSec - eps && e.startSec <= lastAttackSec + eps)
    .sort((a, b) => a.startSec - b.startSec || a.midi - b.midi)

  const steps: PracticeStep[] = []
  for (const e of entries) {
    const last = steps[steps.length - 1]
    if (last && Math.abs(last.startSec - e.startSec) < eps) {
      last.midis.push(e.midi)
      last.durationSec = Math.max(last.durationSec, e.durationSec)
    } else {
      steps.push({
        startSec: e.startSec,
        durationSec: e.durationSec,
        midis: [e.midi],
      })
    }
  }
  return steps
}

/** When the staff index is not ready, build steps from the schedule in the same shape. */
export function practiceStepsFromScheduleFallback(
  notes: { midi: number; startSec: number; durationSec: number }[],
  startSec: number,
  lastAttackSec: number,
): PracticeStep[] {
  const eps = PRACTICE_STEP_TIME_EPS
  const slice = notes
    .filter((n) => n.startSec >= startSec - eps && n.startSec <= lastAttackSec + eps)
    .sort((a, b) => a.startSec - b.startSec || a.midi - b.midi)

  const steps: PracticeStep[] = []
  for (const n of slice) {
    const last = steps[steps.length - 1]
    if (last && Math.abs(last.startSec - n.startSec) < eps) {
      last.midis.push(n.midi)
      last.durationSec = Math.max(last.durationSec, n.durationSec)
    } else {
      steps.push({
        startSec: n.startSec,
        durationSec: n.durationSec,
        midis: [n.midi],
      })
    }
  }
  return steps
}

export function isPracticeDebugEnabled(): boolean {
  try {
    return localStorage.getItem('pst-practice-debug') === '1'
  } catch {
    return false
  }
}

export function logPracticeDebug(label: string, data: unknown): void {
  if (!isPracticeDebugEnabled()) return
  console.info(`[practice] ${label}`, data)
}