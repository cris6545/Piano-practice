const PAGE_SELECTOR = '[id^="osmdCanvasPage"]'

/** Set horizontal page width; OSMD canvas pages must stay direct children of the OSMD container. */
export function arrangeOsmdPagesInRow(container: HTMLElement, pageWidthPx: number): void {
  const pageWidth = Math.max(200, Math.round(pageWidthPx))
  container.style.setProperty('--sheet-page-width', `${pageWidth}px`)

  const legacyStrip = container.querySelector(':scope > .sheet-osmd-strip')
  if (legacyStrip) {
    for (const child of [...legacyStrip.children]) {
      const el = child as HTMLElement
      if (el.matches(PAGE_SELECTOR)) {
        container.insertBefore(el, legacyStrip)
      }
    }
    legacyStrip.remove()
  }
}

export function queryOsmdPageElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`:scope > ${PAGE_SELECTOR}`)]
}