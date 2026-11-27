import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Song, SourceType } from '../types/song'
import { addSong, deleteSong, listSongs } from '../db/songsDb'
import { importScoreFile, stripScoreFileExtension } from '../lib/fileImport'
import './SongList.css'

const FILE_TYPES = '.musicxml,.xml,.mxl,.mid,.midi'

interface SongListProps {
  onOpen: (songId: number) => void
}

export function SongList({ onOpen }: SongListProps) {
  const [songs, setSongs] = useState<Song[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<SourceType | 'all'>('all')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setSongs(await listSongs())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return songs.filter((s) => {
      if (typeFilter !== 'all' && s.sourceType !== typeFilter) return false
      if (!q) return true
      const hay = `${s.title} ${s.composer ?? ''} ${s.originalFileName}`.toLowerCase()
      return hay.includes(q)
    })
  }, [songs, query, typeFilter])

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    setLoading(true)
    try {
      for (const file of Array.from(files)) {
        const imported = await importScoreFile(file)
        await addSong({
          title: imported.title,
          composer: imported.composer,
          sourceType: imported.sourceType,
          musicXml: imported.musicXml,
          originalFileName: imported.originalFileName,
          originalData: imported.originalData,
          schedule: imported.schedule,
        })
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onRemove = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Remove this song from your library?')) return
    await deleteSong(id)
    await refresh()
  }

  return (
    <div className="library">
      <header className="library-header">
        <h1>Piano Sheet Practice</h1>
      </header>

      <div className="library-toolbar">
        <input
          type="search"
          placeholder="Search songs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="library-search"
        />
        <div className="type-filters">
          {(['all', 'musicxml', 'mxl', 'mid'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={typeFilter === t ? 'active' : ''}
              onClick={() => setTypeFilter(t)}
            >
              {t === 'all' ? 'All' : t.toUpperCase()}
            </button>
          ))}
        </div>
        <button type="button" className="add-btn" onClick={() => fileRef.current?.click()} disabled={loading}>
          {loading ? 'Importing…' : '+ Add files'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={FILE_TYPES}
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>

      {error && <p className="library-error">{error}</p>}

      <ul className="song-list">
        {filtered.length === 0 && (
          <li className="song-empty">No songs yet. Add MusicXML, MXL, or MIDI files to begin.</li>
        )}
        {filtered.map((s) => (
          <li key={s.id}>
            <button type="button" className="song-row" onClick={() => s.id != null && onOpen(s.id)}>
              <span className="song-file">{stripScoreFileExtension(s.originalFileName)}</span>
              {s.composer && <span className="song-meta">{s.composer}</span>}
              <span className={`song-badge ${s.sourceType}`}>{s.sourceType}</span>
            </button>
            {s.id != null && (
              <button type="button" className="song-delete" onClick={(e) => void onRemove(s.id!, e)} title="Remove">
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}