import { Midi } from '@tonejs/midi'

type MidiNote = Midi['tracks'][number]['notes'][number]

const TREBLE_SPLIT_MIDI = 60 // middle C and above → staff 1 when not explicit

function midiPitchToStep(pitch: number): { step: string; octave: number; alter: number } {
  const names = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B']
  const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]
  const pc = pitch % 12
  const octave = Math.floor(pitch / 12) - 1
  return { step: names[pc], octave, alter: alters[pc] }
}

function noteXml(staff: number, midi: number, duration: number, chord: boolean, ppq: number): string {
  const { step, octave, alter } = midiPitchToStep(midi)
  const alterTag = alter !== 0 ? `<alter>${alter}</alter>` : ''
  const chordTag = chord ? '<chord/>' : ''
  const type = duration >= ppq * 2 ? 'half' : duration >= ppq ? 'quarter' : 'eighth'
  return `<note>${chordTag}<staff>${staff}</staff><pitch><step>${step}</step>${alterTag}<octave>${octave}</octave></pitch><duration>${duration}</duration><type>${type}</type></note>`
}

interface TickGroup {
  tick: number
  treble: { midi: number; duration: number }[]
  bass: { midi: number; duration: number }[]
}

function mergeAllNotes(midi: Midi): MidiNote[] {
  const all: MidiNote[] = []
  for (const track of midi.tracks) {
    all.push(...track.notes)
  }
  return all.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi)
}

function groupByTick(notes: MidiNote[]): TickGroup[] {
  const map = new Map<number, TickGroup>()
  for (const n of notes) {
    let g = map.get(n.ticks)
    if (!g) {
      g = { tick: n.ticks, treble: [], bass: [] }
      map.set(n.ticks, g)
    }
    const dur = Math.max(1, Math.round(n.durationTicks || 0))
    const entry = { midi: n.midi, duration: dur }
    if (n.midi >= TREBLE_SPLIT_MIDI) g.treble.push(entry)
    else g.bass.push(entry)
  }
  return [...map.values()].sort((a, b) => a.tick - b.tick)
}

function dedupeSamePitch(entries: { midi: number; duration: number }[]): { midi: number; duration: number }[] {
  const byMidi = new Map<number, number>()
  for (const e of entries) {
    const prev = byMidi.get(e.midi) ?? 0
    byMidi.set(e.midi, Math.max(prev, e.duration))
  }
  return [...byMidi.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([midi, duration]) => ({ midi, duration }))
}

/** MIDI → MusicXML with chords, grand staff, and merged tracks. */
export function midiToMusicXml(buffer: ArrayBuffer, title: string): string {
  const midi = new Midi(buffer)
  const rawNotes = mergeAllNotes(midi)
  if (!rawNotes.length) {
    throw new Error('MIDI file has no notes')
  }

  const ppq = midi.header.ppq || 480
  const measureLen = ppq * 4
  const groups = groupByTick(rawNotes).map((g) => ({
    ...g,
    treble: dedupeSamePitch(g.treble),
    bass: dedupeSamePitch(g.bass),
  }))

  let measureNum = 1
  let measureOpen = openMeasure(measureNum, ppq)
  let measureStartTick = 0
  let posInMeasure = 0
  const measures: string[] = []

  const closeMeasure = () => {
    measureOpen += '</measure>'
    measures.push(measureOpen)
  }

  const startNextMeasure = () => {
    measureNum += 1
    measureStartTick += measureLen
    posInMeasure = 0
    measureOpen = openMeasure(measureNum, ppq)
  }

  for (const group of groups) {
    while (group.tick >= measureStartTick + measureLen) {
      closeMeasure()
      startNextMeasure()
    }

    const relTick = group.tick - measureStartTick

    if (relTick > posInMeasure) {
      measureOpen += `<forward><duration>${relTick - posInMeasure}</duration></forward>`
      posInMeasure = relTick
    }

    const treble = group.treble
    const bass = group.bass
    const blockDur = Math.max(
      ...treble.map((n) => n.duration),
      ...bass.map((n) => n.duration),
      1,
    )

    if (treble.length) {
      treble.forEach((n, i) => {
        measureOpen += noteXml(1, n.midi, n.duration, i > 0, ppq)
      })
      posInMeasure += blockDur
    }

    if (bass.length) {
      if (treble.length) {
        measureOpen += `<backup><duration>${blockDur}</duration></backup>`
        posInMeasure -= blockDur
      }
      bass.forEach((n, i) => {
        measureOpen += noteXml(2, n.midi, n.duration, i > 0, ppq)
      })
      posInMeasure += blockDur
    } else if (!treble.length) {
      continue
    }
  }

  closeMeasure()

  const safeTitle = title.replace(/[<>&"']/g, '')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${safeTitle}</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${measures.join('\n')}
  </part>
</score-partwise>`
}

function openMeasure(num: number, ppq: number): string {
  const attrs =
    num === 1
      ? `<attributes>
      <divisions>${ppq}</divisions>
      <key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>
      <staves>2</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef>
      <clef number="2"><sign>F</sign><line>4</line></clef>
    </attributes>`
      : ''
  return `<measure number="${num}">${attrs}`
}