import { useCallback, useEffect, useRef, useState } from 'react'

export interface MidiNoteEvent {
  midi: number
  velocity: number
  type: 'on' | 'off'
}

export function useMidi(onEvent?: (event: MidiNoteEvent) => void) {
  const [supported] = useState(() => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator)
  const [connected, setConnected] = useState(false)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [activeNotes, setActiveNotes] = useState<Set<number>>(() => new Set())
  const activeNotesRef = useRef<Set<number>>(new Set())
  const attachedInputsRef = useRef<WeakSet<MIDIInput>>(new WeakSet())
  const lastNoteOnRef = useRef<{ midi: number; atMs: number } | null>(null)
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  const syncActiveNotes = useCallback(() => {
    setActiveNotes(new Set(activeNotesRef.current))
  }, [])

  const connect = useCallback(async () => {
    if (!supported) return
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      const attach = (input: MIDIInput) => {
        if (attachedInputsRef.current.has(input)) return
        attachedInputsRef.current.add(input)

        input.onmidimessage = (msg) => {
          if (!msg.data) return
          const [status, note, velocity] = msg.data
          const command = status & 0xf0
          if (command === 0x90 && velocity > 0) {
            const now = performance.now()
            const dup = lastNoteOnRef.current
            if (dup && dup.midi === note && now - dup.atMs < 20) return
            if (activeNotesRef.current.has(note)) return
            lastNoteOnRef.current = { midi: note, atMs: now }
            activeNotesRef.current.add(note)
            syncActiveNotes()
            handlerRef.current?.({ midi: note, velocity, type: 'on' })
          } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
            activeNotesRef.current.delete(note)
            if (lastNoteOnRef.current?.midi === note) lastNoteOnRef.current = null
            syncActiveNotes()
            handlerRef.current?.({ midi: note, velocity: 0, type: 'off' })
          }
        }
        setDeviceName(input.name ?? 'MIDI keyboard')
        setConnected(true)
      }

      for (const input of access.inputs.values()) {
        attach(input)
      }
      access.onstatechange = (e) => {
        const port = e.port
        if (port?.type === 'input' && port.state === 'connected') {
          attach(port as MIDIInput)
        }
      }
    } catch {
      setConnected(false)
    }
  }, [supported])

  useEffect(() => {
    if (supported) void connect()
  }, [supported, connect])

  return { supported, connected, deviceName, activeNotes, connect }
}