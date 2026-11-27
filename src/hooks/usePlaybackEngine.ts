import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScheduledNote } from '../types/song'
import { getPianoAudioState, subscribePianoAudioState } from '../audio/pianoAudio'
import { getPlaybackPositionSec, schedulePlayback, stopPlaybackAudio } from '../audio/midianoAudio'
import { playbackDurationSec } from '../engine/midiSchedule'

export function usePlaybackEngine(notes: ScheduledNote[]) {
  const [playing, setPlaying] = useState(false)
  const [audioSnapshot, setAudioSnapshot] = useState(getPianoAudioState)
  const [positionSec, setPositionSec] = useState(0)
  const pausedAtRef = useRef(0)
  const notesRef = useRef(notes)
  notesRef.current = notes

  useEffect(() => subscribePianoAudioState(() => setAudioSnapshot(getPianoAudioState())), [])

  const pianoLoading = audioSnapshot.state === 'loading'
  const pianoError = audioSnapshot.state === 'error' ? audioSnapshot.error : null

  const stop = useCallback(() => {
    stopPlaybackAudio()
    setPlaying(false)
    setPositionSec(0)
    pausedAtRef.current = 0
  }, [])

  const startAt = useCallback(
    async (fromSec: number, endSec?: number, onEnded?: () => void) => {
      pausedAtRef.current = fromSec
      setPlaying(true)

      try {
        await schedulePlayback(
          notesRef.current,
          fromSec,
          (t) => setPositionSec(t),
          () => {
            setPlaying(false)
            if (endSec != null) {
              setPositionSec(endSec)
              pausedAtRef.current = endSec
            } else {
              setPositionSec(0)
              pausedAtRef.current = 0
            }
            onEnded?.()
          },
          endSec,
        )
      } catch {
        stop()
      }
    },
    [stop],
  )

  const play = useCallback(() => startAt(pausedAtRef.current), [startAt])
  const restart = useCallback(() => {
    pausedAtRef.current = 0
    void startAt(0)
  }, [startAt])

  const playRange = useCallback(
    (fromSec: number, endSec: number, onEnded?: () => void) => startAt(fromSec, endSec, onEnded),
    [startAt],
  )

  const pause = useCallback(() => {
    pausedAtRef.current = getPlaybackPositionSec()
    stopPlaybackAudio()
    setPlaying(false)
    setPositionSec(pausedAtRef.current)
  }, [])

  const resume = useCallback(() => {
    void startAt(pausedAtRef.current)
  }, [startAt])

  const seek = useCallback(
    (toSec: number) => {
      const max = playbackDurationSec(notesRef.current)
      const clamped = Math.max(0, Math.min(toSec, max))
      pausedAtRef.current = clamped
      setPositionSec(clamped)
      if (playing) void startAt(clamped)
    },
    [playing, startAt],
  )

  useEffect(() => () => stopPlaybackAudio(), [])

  return useMemo(
    () => ({
      playing,
      pianoLoading,
      pianoError,
      play,
      pause,
      resume,
      restart,
      stop,
      seek,
      playRange,
      positionSec,
    }),
    [playing, pianoLoading, pianoError, play, pause, resume, restart, stop, seek, playRange, positionSec],
  )
}