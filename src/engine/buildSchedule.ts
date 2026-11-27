import type { SourceType, ScheduledNote } from '../types/song'
import { buildScheduleFromMidi } from './midiSchedule'
import { buildScheduleFromMusicXml } from '../lib/musicXmlPlayback'

export function buildSchedule(
  sourceType: SourceType,
  originalData: ArrayBuffer | undefined,
  musicXml: string,
): ScheduledNote[] {
  if (sourceType === 'mid' && originalData?.byteLength) {
    return buildScheduleFromMidi(originalData)
  }
  return buildScheduleFromMusicXml(musicXml)
}