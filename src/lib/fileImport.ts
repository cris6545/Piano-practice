import type { SourceType, ScheduledNote } from '../types/song'
import { buildSchedule } from '../engine/buildSchedule'
import { midiTitle } from '../engine/midiSchedule'
import { midiToMusicXml } from './midiToMusicXml'
import { mxlToMusicXml } from './mxlToXml'

export interface ImportedScore {
  title: string
  composer?: string
  sourceType: SourceType
  musicXml: string
  originalFileName: string
  originalData: ArrayBuffer
  schedule: ScheduledNote[]
}

const SCORE_EXT = /\.(musicxml|xml|mxl|mid|midi)$/i

export function stripScoreFileExtension(name: string): string {
  return name.replace(SCORE_EXT, '')
}

function titleFromFileName(name: string): string {
  return stripScoreFileExtension(name).replace(/[-_]/g, ' ')
}

function parseMetaFromMusicXml(xml: string): { title?: string; composer?: string } {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const title =
    doc.querySelector('work-title')?.textContent?.trim() ||
    doc.querySelector('movement-title')?.textContent?.trim()
  const composer = doc.querySelector('creator[type="composer"]')?.textContent?.trim()
  return { title, composer }
}

export async function importScoreFile(file: File): Promise<ImportedScore> {
  const lower = file.name.toLowerCase()
  const originalData = await file.arrayBuffer()

  if (lower.endsWith('.mxl')) {
    const musicXml = await mxlToMusicXml(originalData)
    const meta = parseMetaFromMusicXml(musicXml)
    const schedule = buildSchedule('mxl', originalData, musicXml)
    return {
      title: meta.title ?? titleFromFileName(file.name),
      composer: meta.composer,
      sourceType: 'mxl',
      musicXml,
      originalFileName: file.name,
      originalData,
      schedule,
    }
  }

  if (lower.endsWith('.musicxml') || lower.endsWith('.xml')) {
    const musicXml = new TextDecoder().decode(originalData)
    const meta = parseMetaFromMusicXml(musicXml)
    const schedule = buildSchedule('musicxml', originalData, musicXml)
    return {
      title: meta.title ?? titleFromFileName(file.name),
      composer: meta.composer,
      sourceType: 'musicxml',
      musicXml,
      originalFileName: file.name,
      originalData,
      schedule,
    }
  }

  if (lower.endsWith('.mid') || lower.endsWith('.midi')) {
    const title = midiTitle(originalData, file.name)
    const musicXml = midiToMusicXml(originalData, title)
    const schedule = buildSchedule('mid', originalData, musicXml)
    return {
      title,
      sourceType: 'mid',
      musicXml,
      originalFileName: file.name,
      originalData,
      schedule,
    }
  }

  throw new Error('Unsupported file type. Use .musicxml, .xml, .mxl, .mid, or .midi')
}