import type { PracticeTimeRange } from './osmdPracticeSelection'
import type { PracticeStep } from './practiceSteps'

export const PRACTICE_PASSES_REQUIRED = 2
export const PRACTICE_MIN_TEMPO_RATIO = 0.9
/** Small slack for MIDI / human timing jitter. */
export const PRACTICE_TEMPO_TOLERANCE_SEC = 0.12
/** Min match between each gap’s time share and the score’s (1 = perfectly steady). */
export const PRACTICE_MIN_RHYTHM_CONSISTENCY = 0.9
const MIN_NOMINAL_GAP_SEC = 0.004

export function practiceSectionKey(range: PracticeTimeRange): string {
  return `${range.startSec.toFixed(4)}:${range.lastAttackSec.toFixed(4)}:${range.startGroupIndex}:${range.endGroupIndex}`
}

export function nominalSectionDurationSec(range: PracticeTimeRange): number {
  return Math.max(0.02, range.endSec - range.startSec)
}

export function maxSectionWallSec(nominalSec: number): number {
  return nominalSec / PRACTICE_MIN_TEMPO_RATIO + PRACTICE_TEMPO_TOLERANCE_SEC
}

/**
 * How steadily you kept the score’s rhythm shape (not how fast overall).
 * Compares each gap’s share of your wall time to that gap’s share of score time.
 */
export function rhythmConsistencyFromAttacks(
  steps: PracticeStep[],
  stepAttackMs: number[],
): number {
  if (steps.length < 2) return 1

  const nominalGaps: number[] = []
  for (let i = 1; i < steps.length; i++) {
    nominalGaps.push(Math.max(0, steps[i].startSec - steps[i - 1].startSec))
  }

  const attacks = stepAttackMs.filter((t) => Number.isFinite(t))
  if (attacks.length < 2) return 1

  const actualGaps: number[] = []
  for (let i = 1; i < attacks.length; i++) {
    actualGaps.push(Math.max(0, attacks[i] - attacks[i - 1]))
  }

  const n = Math.min(nominalGaps.length, actualGaps.length)
  if (n === 0) return 1

  const sumNom = nominalGaps.slice(0, n).reduce((a, b) => a + b, 0)
  const sumAct = actualGaps.slice(0, n).reduce((a, b) => a + b, 0)
  if (sumNom < MIN_NOMINAL_GAP_SEC || sumAct < 1) return 1

  let minConsistency = 1
  for (let i = 0; i < n; i++) {
    if (nominalGaps[i] < MIN_NOMINAL_GAP_SEC) continue
    const p = nominalGaps[i] / sumNom
    const q = actualGaps[i] / sumAct
    if (p <= 0 || q <= 0) {
      minConsistency = 0
      continue
    }
    const c = Math.min(q / p, p / q)
    minConsistency = Math.min(minConsistency, c)
  }
  return minConsistency
}

export function isSuccessfulSectionRun(
  elapsedSec: number,
  nominalSec: number,
  hadWrongKey: boolean,
  rhythmConsistency: number,
): boolean {
  if (hadWrongKey) return false
  if (nominalSec <= 0) return false
  if (elapsedSec > maxSectionWallSec(nominalSec)) return false
  return rhythmConsistency >= PRACTICE_MIN_RHYTHM_CONSISTENCY
}