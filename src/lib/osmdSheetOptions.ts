import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

/** Zoom multiplier — readable staff on screen-sized pages. */
export const SHEET_ZOOM = 1.25

const MIN_LAYOUT_PX = 10

/**
 * Minimum custom page height (same unit system as width in setCustomPageFormat).
 * At SHEET_ZOOM 1.25, OSMD divides by zoom for viewBox units — 520 → 416 internal units
 * (enough for treble + bass + margins).
 */
export const GRAND_STAFF_MIN_PAGE_HEIGHT = 520

/**
 * Single-staff scores need a shorter page — otherwise OSMD stacks a second system on the
 * same page instead of starting the next horizontal page.
 */
export const SINGLE_STAFF_MIN_PAGE_HEIGHT = 280

/** Max staves on one system from MusicXML (more reliable than OSMD sheet for single-staff parts). */
export function maxStavesInMusicXml(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  let maxDeclared = 1
  for (const el of doc.querySelectorAll('measure attributes staves')) {
    const n = parseInt(el.textContent?.trim() ?? '', 10)
    if (!Number.isNaN(n) && n > maxDeclared) maxDeclared = n
  }
  const partCount = doc.querySelectorAll('part-list score-part').length
  if (maxDeclared === 1 && partCount > 1) return partCount
  return maxDeclared
}

export function layoutStaffCount(osmd: OpenSheetMusicDisplay, musicXml?: string): number {
  if (musicXml?.trim()) return maxStavesInMusicXml(musicXml)
  return scoreStaffCount(osmd)
}

/** Staves visible on one system (after load). */
export function scoreStaffCount(osmd: OpenSheetMusicDisplay): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheet = osmd.Sheet as any
  if (!sheet) return 2

  const listed = sheet.Staves?.length ?? sheet.staves?.length
  if (typeof listed === 'number' && listed > 0) return listed

  let maxInInstrument = 1
  for (const inst of sheet.Instruments ?? []) {
    const n = inst.Staves?.length ?? inst.Staffs?.length ?? 1
    if (typeof n === 'number' && n > maxInInstrument) maxInInstrument = n
  }
  return maxInInstrument
}

/**
 * Page height for exactly one music system. Must not grow with page width — a wide
 * viewport only adds horizontal measure space; extra vertical height lets OSMD stack rows.
 */
function oneSystemPageHeight(staffCount: number): number {
  if (staffCount <= 1) return SINGLE_STAFF_MIN_PAGE_HEIGHT
  if (staffCount <= 2) return GRAND_STAFF_MIN_PAGE_HEIGHT
  return GRAND_STAFF_MIN_PAGE_HEIGHT + (staffCount - 2) * 200
}

/** Options that must be applied in the OSMD constructor before load(). */
export const OSMD_CONSTRUCTOR_OPTIONS = {
  /** We resize via ResizeObserver + prepareOsmdBeforeRender (page format + strip layout). */
  autoResize: false,
  drawingParameters: 'default' as const,
  renderSingleHorizontalStaffline: false,
  pageBackgroundColor: '#ffffff',
  defaultColorMusic: '#000000',
  darkMode: false,
  newSystemFromXML: false,
  newPageFromXML: false,
  newSystemFromNewPageInXML: false,
  disableCursor: false,
  drawTitle: false,
  drawSubtitle: false,
  drawComposer: false,
  drawLyricist: false,
  drawCredits: false,
}

export function hasRenderableSheetLayout(container: HTMLElement | null | undefined): boolean {
  if (!container || !container.isConnected) return false
  return container.clientWidth >= MIN_LAYOUT_PX && container.clientHeight >= MIN_LAYOUT_PX
}

/** Returns false when container size is invalid — do not call osmd.render() in that case. */
export function prepareOsmdBeforeRender(
  osmd: OpenSheetMusicDisplay,
  container: HTMLElement | null | undefined,
  layoutWidthPx?: number,
  musicXml?: string,
): boolean {
  if (!hasRenderableSheetLayout(container)) return false

  osmd.Zoom = SHEET_ZOOM
  const rules = osmd.EngravingRules
  rules.RenderSingleHorizontalStaffline = false
  rules.RenderXMeasuresPerLineAkaSystem = 0
  rules.NewSystemAtXMLNewSystemAttribute = false
  rules.NewPageAtXMLNewPageAttribute = false
  rules.NewSystemAtXMLNewPageAttribute = false
  rules.PageBackgroundColor = '#ffffff'
  rules.DarkModeEnabled = false

  const fromLayout =
    layoutWidthPx != null && layoutWidthPx >= MIN_LAYOUT_PX ? Math.round(layoutWidthPx) : 0
  const w = fromLayout > 0 ? fromLayout : Math.round(container!.clientWidth)
  const pageH = oneSystemPageHeight(layoutStaffCount(osmd, musicXml))
  osmd.setCustomPageFormat(w, pageH)
  return true
}