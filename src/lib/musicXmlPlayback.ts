import type { ScheduledNote } from '../types/song'

export interface TimedNote {
  midi: number
  time: number
  duration: number
}

/** MusicXML playback (non-MIDI uploads). */
export function buildScheduleFromMusicXml(musicXml: string): ScheduledNote[] {
  return extractTimedNotes(musicXml).map((n) => ({
    midi: n.midi,
    startSec: n.time,
    durationSec: n.duration,
    velocity: 90,
  }))
}

/** Walk MusicXML and build a timeline in seconds for Tone.js (all parts merged). */
export function extractTimedNotes(musicXml: string): TimedNote[] {
  const doc = new DOMParser().parseFromString(musicXml, 'text/xml')
  if (doc.querySelector('parsererror')) {
    return []
  }

  const parts = doc.getElementsByTagName('part')
  const noteLists: TimedNote[][] = []

  for (let p = 0; p < parts.length; p++) {
    noteLists.push(collectPartNotes(parts[p]))
  }

  const notes = noteLists.flat().sort((a, b) => a.time - b.time || a.midi - b.midi)
  return mergeSimultaneous(notes)
}

function collectPartNotes(part: Element): TimedNote[] {
  const notes: TimedNote[] = []
  let divisions = 480
  let tempo = 90
  let secondsPerDivision = 60 / tempo / divisions
  let scoreDiv = 0

  const measures = part.getElementsByTagName('measure')
  for (let m = 0; m < measures.length; m++) {
    const measure = measures[m]
    const attrs = measure.getElementsByTagName('attributes')[0]
    if (attrs) {
      const divEl = attrs.getElementsByTagName('divisions')[0]
      if (divEl?.textContent) {
        divisions = Number(divEl.textContent) || divisions
        secondsPerDivision = 60 / tempo / divisions
      }
    }

    const dirs = measure.getElementsByTagName('direction')
    for (let d = 0; d < dirs.length; d++) {
      const metronome = dirs[d].getElementsByTagName('metronome')[0]
      if (metronome) {
        const perMin = metronome.getElementsByTagName('per-minute')[0]
        if (perMin?.textContent) {
          tempo = Number(perMin.textContent) || tempo
          secondsPerDivision = 60 / tempo / divisions
        }
      }
      const sound = dirs[d].getElementsByTagName('sound')[0]
      const t = sound?.getAttribute('tempo')
      if (t) {
        tempo = Number(t) || tempo
        secondsPerDivision = 60 / tempo / divisions
      }
    }

    const measureStartDiv = scoreDiv
    let measurePosDiv = 0
    let maxPosInMeasure = 0

    const children = measure.children
    for (let i = 0; i < children.length; i++) {
      const el = children[i]
      const tag = localTag(el)

      if (tag === 'backup') {
        const dur = Number(el.getElementsByTagName('duration')[0]?.textContent ?? 0)
        measurePosDiv -= dur
        continue
      }
      if (tag === 'forward') {
        const dur = Number(el.getElementsByTagName('duration')[0]?.textContent ?? 0)
        measurePosDiv += dur
        maxPosInMeasure = Math.max(maxPosInMeasure, measurePosDiv)
        continue
      }
      if (tag !== 'note') continue

      if (el.getElementsByTagName('rest').length) continue
      if (el.getElementsByTagName('grace')[0] && !el.getElementsByTagName('chord').length) {
        continue
      }

      const chord = el.getElementsByTagName('chord').length > 0
      const stepEl = el.getElementsByTagName('step')[0]
      const octaveEl = el.getElementsByTagName('octave')[0]
      if (!stepEl || !octaveEl) continue

      const step = stepEl.textContent ?? 'C'
      const alter = Number(el.getElementsByTagName('alter')[0]?.textContent ?? 0)
      const octave = Number(octaveEl.textContent ?? 4)
      const midi = pitchToMidi(step, alter, octave)

      const durationDiv = Number(el.getElementsByTagName('duration')[0]?.textContent ?? divisions)
      const durationSec = Math.max(0.05, durationDiv * secondsPerDivision)
      const attackDiv = measureStartDiv + measurePosDiv
      const timeSec = attackDiv * secondsPerDivision

      notes.push({ midi, time: timeSec, duration: durationSec })

      if (!chord) {
        measurePosDiv += durationDiv
        maxPosInMeasure = Math.max(maxPosInMeasure, measurePosDiv)
      }
    }

    scoreDiv = measureStartDiv + maxPosInMeasure
  }

  return notes
}

/** Deduplicate same-time same-pitch entries from merged parts. */
function mergeSimultaneous(notes: TimedNote[]): TimedNote[] {
  const seen = new Set<string>()
  const out: TimedNote[] = []
  for (const n of notes) {
    const key = `${n.time.toFixed(4)}:${n.midi}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}

function localTag(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase().replace(/.*:/, '')
}

function pitchToMidi(step: string, alter: number, octave: number): number {
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const s = step.toUpperCase()[0]
  if (!(s in base)) return 60
  return (octave + 1) * 12 + base[s] + alter
}

export function playbackEndSeconds(notes: TimedNote[]): number {
  if (!notes.length) return 0
  return notes.reduce((end, n) => Math.max(end, n.time + n.duration), 0)
}