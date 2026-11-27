import type { PlayerMode } from '../types/song'
import './PlayerToolbar.css'

interface PlayerToolbarProps {
  mode: PlayerMode
  playing: boolean
  midiConnected: boolean
  midiLabel: string | null
  onBack: () => void
  onPractice: () => void
  onPlay: () => void
  onPause: () => void
  onRestart: () => void
  onStopMode: () => void
}

export function PlayerToolbar({
  mode,
  playing,
  midiConnected,
  midiLabel,
  onBack,
  onPractice,
  onPlay,
  onPause,
  onRestart,
  onStopMode,
}: PlayerToolbarProps) {
  return (
    <header className="player-toolbar">
      <button type="button" className="tb-btn ghost" onClick={onBack} title="Back to library">
        ← Library
      </button>

      <div className="tb-modes" role="toolbar" aria-label="Playback controls">
        <button
          type="button"
          className={`tb-btn icon ${mode === 'practice' || mode === 'practice-select' ? 'active' : ''}`}
          onClick={onPractice}
          title="Practice — wait for correct keys"
        >
          <span aria-hidden>🎯</span>
          <span className="tb-label">Practice</span>
        </button>
        <button
          type="button"
          className={`tb-btn icon ${mode === 'playback' ? 'active' : ''}`}
          onClick={onPlay}
          title="Play full song"
        >
          <span aria-hidden>▶</span>
          <span className="tb-label">Play</span>
        </button>
        {mode === 'playback' && playing && (
          <button type="button" className="tb-btn icon" onClick={onPause} title="Pause">
            <span aria-hidden>⏸</span>
            <span className="tb-label">Pause</span>
          </button>
        )}
        {mode === 'playback' && !playing && (
          <button type="button" className="tb-btn icon" onClick={onPlay} title="Resume">
            <span aria-hidden>▶</span>
            <span className="tb-label">Resume</span>
          </button>
        )}
        <button type="button" className="tb-btn icon" onClick={onRestart} title="Restart from beginning">
          <span aria-hidden>↺</span>
          <span className="tb-label">Restart</span>
        </button>
        {mode !== 'idle' && (
          <button type="button" className="tb-btn icon" onClick={onStopMode} title="Stop mode">
            <span aria-hidden>■</span>
            <span className="tb-label">Stop</span>
          </button>
        )}
      </div>

      <div className={`tb-midi ${midiConnected ? 'ok' : ''}`} title="MIDI keyboard">
        {midiConnected ? `🎹 ${midiLabel ?? 'Connected'}` : '🎹 Connect a keyboard (Chrome/Edge)'}
      </div>
    </header>
  )
}