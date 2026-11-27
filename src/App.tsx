import { useEffect, useState } from 'react'
import { getSong } from './db/songsDb'
import type { Song } from './types/song'
import { SongList } from './components/SongList'
import { SongPlayer } from './components/SongPlayer'
import './App.css'

function App() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [song, setSong] = useState<Song | null>(null)

  useEffect(() => {
    if (selectedId == null) {
      setSong(null)
      return
    }
    void getSong(selectedId).then((s) => setSong(s ?? null))
  }, [selectedId])

  if (selectedId != null && song) {
    return <SongPlayer song={song} onBack={() => setSelectedId(null)} />
  }

  return <SongList onOpen={(id) => setSelectedId(id)} />
}

export default App