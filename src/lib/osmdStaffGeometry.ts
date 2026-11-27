/** Parsed from rendered vf-stave / staffline groups in OSMD SVG. */
export interface StaffLinesGeometry {
  topLineY: number
  bottomLineY: number
  lineSpacing: number
}

export interface GrandStaffGeometry {
  treble: StaffLinesGeometry
  bass: StaffLinesGeometry
}

const geometryCache = new WeakMap<SVGSVGElement, Map<number, GrandStaffGeometry>>()

function cacheKey(nearX: number | undefined): number {
  return nearX == null ? -1 : Math.round(nearX / 40)
}

function parseHorizontalLineY(el: Element): number | null {
  if (el.tagName === 'line') {
    const y1 = parseFloat(el.getAttribute('y1') ?? '')
    const y2 = parseFloat(el.getAttribute('y2') ?? '')
    if (!Number.isFinite(y1) || !Number.isFinite(y2)) return null
    if (Math.abs(y1 - y2) > 0.5) return null
    return y1
  }
  if (el.tagName === 'path') {
    const d = el.getAttribute('d') ?? ''
    const m = /^M\s*([\d.-]+)\s*([\d.-]+)\s*L\s*([\d.-]+)\s*([\d.-]+)/i.exec(d.trim())
    if (!m) return null
    const y1 = parseFloat(m[2])
    const y2 = parseFloat(m[4])
    if (!Number.isFinite(y1) || !Number.isFinite(y2)) return null
    if (Math.abs(y1 - y2) > 0.5) return null
    return y1
  }
  return null
}

function staffLineYsFromGroup(group: SVGGElement): number[] {
  const ys = new Set<number>()
  for (const el of group.querySelectorAll('line, path')) {
    const y = parseHorizontalLineY(el)
    if (y != null) ys.add(y)
  }
  return [...ys].sort((a, b) => a - b)
}

function clusterToFiveLines(ys: number[]): number[] | null {
  if (ys.length < 5) return null
  if (ys.length === 5) return ys

  let best: number[] | null = null
  let bestVariance = Infinity

  for (let start = 0; start <= ys.length - 5; start++) {
    const five = ys.slice(start, start + 5)
    const gaps = fourGaps(five)
    if (gaps.some((g) => g <= 0)) continue
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length
    if (variance < bestVariance) {
      bestVariance = variance
      best = five
    }
  }
  return best
}

function fourGaps(sortedYs: number[]): number[] {
  const gaps: number[] = []
  for (let i = 1; i < sortedYs.length; i++) {
    gaps.push(sortedYs[i] - sortedYs[i - 1])
  }
  return gaps
}

function geometryFromFiveLines(lines: number[]): StaffLinesGeometry | null {
  if (lines.length !== 5) return null
  const gaps = fourGaps(lines)
  const lineSpacing = gaps.reduce((a, b) => a + b, 0) / gaps.length
  if (lineSpacing <= 0) return null
  return {
    topLineY: lines[0],
    bottomLineY: lines[4],
    lineSpacing,
  }
}

function groupSpansX(group: SVGGElement, x: number): boolean {
  for (const line of group.querySelectorAll('line')) {
    const x1 = parseFloat(line.getAttribute('x1') ?? '')
    const x2 = parseFloat(line.getAttribute('x2') ?? '')
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) continue
    const min = Math.min(x1, x2)
    const max = Math.max(x1, x2)
    if (x >= min - 4 && x <= max + 4) return true
  }
  for (const path of group.querySelectorAll('path')) {
    try {
      const bb = path.getBBox()
      if (x >= bb.x - 4 && x <= bb.x + bb.width + 4) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

function staveGroupsInSvg(svg: SVGSVGElement, nearX?: number): SVGGElement[] {
  const groups: SVGGElement[] = []
  const seen = new Set<SVGGElement>()

  for (const el of svg.querySelectorAll<SVGGElement>('[id^="osmd-staffline"]')) {
    if (!seen.has(el)) {
      seen.add(el)
      groups.push(el)
    }
  }

  if (groups.length < 2) {
    for (const el of svg.querySelectorAll<SVGGElement>('g.vf-stave')) {
      if (!seen.has(el)) {
        seen.add(el)
        groups.push(el)
      }
    }
  }

  if (nearX == null) return groups
  const atX = groups.filter((g) => groupSpansX(g, nearX))
  return atX.length ? atX : groups
}

/** Read treble (upper) and bass (lower) staff metrics from the active page SVG. */
export function measureGrandStaffGeometry(
  svg: SVGSVGElement,
  nearX?: number,
): GrandStaffGeometry | null {
  const key = cacheKey(nearX)
  let byKey = geometryCache.get(svg)
  if (!byKey) {
    byKey = new Map()
    geometryCache.set(svg, byKey)
  }
  const cached = byKey.get(key)
  if (cached) return cached

  const parsed: { medianY: number; geom: StaffLinesGeometry }[] = []

  for (const group of staveGroupsInSvg(svg, nearX)) {
    const ys = staffLineYsFromGroup(group)
    const five = clusterToFiveLines(ys)
    if (!five) continue
    const geom = geometryFromFiveLines(five)
    if (!geom) continue
    const medianY = five[2]
    parsed.push({ medianY, geom })
  }

  if (parsed.length < 2) return null

  parsed.sort((a, b) => a.medianY - b.medianY)
  const treble = parsed[0].geom
  const bass = parsed[parsed.length - 1].geom

  const out: GrandStaffGeometry = { treble, bass }
  byKey.set(key, out)
  return out
}

export function clearStaffGeometryCache(svg?: SVGSVGElement | null): void {
  if (svg) geometryCache.delete(svg)
}