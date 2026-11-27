import { SplendidGrandPiano, type Smplr } from 'smplr'

export type PianoAudioState = 'idle' | 'loading' | 'ready' | 'error'

type StateSnapshot = { state: PianoAudioState; error: string | null }

let audioContext: AudioContext | null = null
let piano: Smplr | null = null
let loadPromise: Promise<void> | null = null

let state: PianoAudioState = 'idle'
let errorMessage: string | null = null

const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((fn) => fn())
}

function setState(next: PianoAudioState, error: string | null = null): void {
  state = next
  errorMessage = error
  emit()
}

export function getPianoAudioState(): StateSnapshot {
  return { state, error: errorMessage }
}

export function subscribePianoAudioState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

/** Resume context and load Splendid Grand Piano once per session (full instrument). */
export async function ensureReady(): Promise<void> {
  const ctx = getAudioContext()
  await ctx.resume()

  if (state === 'ready' && piano) {
    return
  }

  if (state === 'loading' && loadPromise) {
    await loadPromise
    const snap = getPianoAudioState()
    if (snap.state === 'ready') return
    throw new Error(snap.error ?? 'Piano failed to load')
  }

  if (state === 'error') {
    piano?.dispose()
    piano = null
    loadPromise = null
  }

  setState('loading', null)

  try {
    if (!piano) {
      piano = SplendidGrandPiano(ctx, {
        baseUrl: `${import.meta.env.BASE_URL}samples/piano`,
        formats: ['ogg'],
      })
    }
    loadPromise = piano.ready
    await Promise.race([
      loadPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Piano sample load timed out (120s). Check public/samples/piano.')), 120_000),
      ),
    ])
    setState('ready')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    setState('error', msg)
    loadPromise = null
    piano?.dispose()
    piano = null
    throw new Error(msg)
  }
}

/** Play at `when` (AudioContext time) or immediately if omitted. */
export function playNote(midiNote: number, velocity = 90, durationSec = 0.5, when?: number): void {
  if (state !== 'ready' || !piano) {
    console.warn('[pianoAudio] playNote skipped — state:', state)
    return
  }
  const ctx = getAudioContext()
  const time = when ?? ctx.currentTime
  piano.start({
    note: midiNote,
    velocity: Math.max(1, Math.min(127, velocity)),
    time,
    duration: durationSec,
  })
}

/** Stop sounding notes and cancel smplr's scheduled queue. */
export function stopAll(): void {
  piano?.stop()
  piano?.scheduler.stop()
}