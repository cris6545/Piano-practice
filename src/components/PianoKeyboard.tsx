import './PianoKeyboard.css'

const MIDI_START = 21
const MIDI_END = 108
const BLACK_OFFSETS = new Set([1, 3, 6, 8, 10])

interface PianoKeyboardProps {
  highlight: Set<number>
  pressed: Set<number>
}

export function PianoKeyboard({ highlight, pressed }: PianoKeyboardProps) {
  const keys: { midi: number; black: boolean }[] = []
  for (let midi = MIDI_START; midi <= MIDI_END; midi++) {
    keys.push({ midi, black: BLACK_OFFSETS.has(midi % 12) })
  }
  const whitesTotal = countWhitesUpTo(MIDI_END + 1)

  return (
    <div
      className="piano-wrap"
      aria-label="Piano keyboard"
      style={{ '--white-count': whitesTotal } as React.CSSProperties}
    >
      <div className="piano-whites">
        {keys
          .filter((k) => !k.black)
          .map(({ midi }) => (
            <div
              key={midi}
              className={classFor(midi, 'white', highlight, pressed)}
              data-midi={midi}
            />
          ))}
      </div>
      <div className="piano-blacks">
        {keys
          .filter((k) => k.black)
          .map(({ midi }) => (
            <div
              key={midi}
              className={classFor(midi, 'black', highlight, pressed)}
              data-midi={midi}
              style={{ left: `${blackKeyLeftPercent(midi)}%` }}
            />
          ))}
      </div>
    </div>
  )
}

function classFor(midi: number, kind: 'white' | 'black', highlight: Set<number>, pressed: Set<number>) {
  return [
    'key',
    kind,
    highlight.has(midi) ? 'highlight' : '',
    pressed.has(midi) ? 'pressed' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function blackKeyLeftPercent(midi: number): number {
  const whiteBefore = countWhitesUpTo(midi)
  const whitesTotal = countWhitesUpTo(MIDI_END + 1)
  return (whiteBefore / whitesTotal) * 100
}

function countWhitesUpTo(midi: number): number {
  let n = 0
  for (let m = MIDI_START; m < midi; m++) {
    if (!BLACK_OFFSETS.has(m % 12)) n++
  }
  return n
}
