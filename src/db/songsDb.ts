import Dexie, { type EntityTable } from 'dexie'
import type { Song, SongProgress } from '../types/song'
import { buildSchedule } from '../engine/buildSchedule'

class PianoSheetDb extends Dexie {
  songs!: EntityTable<Song, 'id'>
  progress!: EntityTable<SongProgress, 'id'>

  constructor() {
    super('PianoSheetTrainer')
    this.version(1).stores({
      songs: '++id, title, sourceType, addedAt',
      progress: '++id, songId',
    })
    this.version(2)
      .stores({
        songs: '++id, title, sourceType, addedAt',
        progress: '++id, songId',
      })
      .upgrade(async (tx) => {
        const table = tx.table<Song, number>('songs')
        await table.toCollection().modify((song) => {
          if (!song.schedule) {
            song.schedule = buildSchedule(song.sourceType, song.originalData, song.musicXml ?? '')
          }
        })
      })
  }
}

export const db = new PianoSheetDb()

export async function listSongs(): Promise<Song[]> {
  return db.songs.orderBy('addedAt').reverse().toArray()
}

export async function addSong(song: Omit<Song, 'id' | 'addedAt'>): Promise<number> {
  const id = await db.songs.add({ ...song, addedAt: Date.now() })
  return id as number
}

export async function deleteSong(id: number): Promise<void> {
  await db.progress.where('songId').equals(id).delete()
  await db.songs.delete(id)
}

export async function getSong(id: number): Promise<Song | undefined> {
  const song = await db.songs.get(id)
  if (!song) return undefined
  if (!song.schedule?.length && song.musicXml) {
    song.schedule = buildSchedule(song.sourceType, song.originalData, song.musicXml)
  }
  return song
}

export async function saveProgress(songId: number, practiceGroupIndex: number): Promise<void> {
  const existing = await db.progress.where('songId').equals(songId).first()
  const row: SongProgress = {
    songId,
    practiceGroupIndex,
    updatedAt: Date.now(),
    ...(existing?.id != null ? { id: existing.id } : {}),
  }
  await db.progress.put(row)
}

export async function getProgress(songId: number): Promise<SongProgress | undefined> {
  return db.progress.where('songId').equals(songId).first()
}