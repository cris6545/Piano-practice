const programmatic = new WeakMap<HTMLElement, boolean>()
const lockedScrollLeft = new WeakMap<HTMLElement, number>()

type ScrollLockCleanup = () => void
const cleanups = new WeakMap<HTMLElement, ScrollLockCleanup>()

/** Run scrollLeft/scrollTop updates while playback snap is driving the sheet. */
export function programmaticSheetScroll(el: HTMLElement, apply: () => void): void {
  programmatic.set(el, true)
  try {
    apply()
    lockedScrollLeft.set(el, el.scrollLeft)
  } finally {
    requestAnimationFrame(() => {
      programmatic.set(el, false)
    })
  }
}

/** Block wheel, touch pan, and scrollbar drag on the sheet; re-enable when `locked` is false. */
export function setUserSheetScrollLocked(el: HTMLElement, locked: boolean): void {
  if (locked) {
    if (cleanups.has(el)) return
    lockedScrollLeft.set(el, el.scrollLeft)

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
    }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
    }
    const onScroll = () => {
      if (programmatic.get(el)) return
      const left = lockedScrollLeft.get(el) ?? el.scrollLeft
      if (el.scrollLeft === left) return
      programmatic.set(el, true)
      el.scrollLeft = left
      requestAnimationFrame(() => programmatic.set(el, false))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('scroll', onScroll, { passive: true })
    el.classList.add('sheet-osmd--scroll-locked')

    cleanups.set(el, () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('scroll', onScroll)
      el.classList.remove('sheet-osmd--scroll-locked')
      cleanups.delete(el)
    })
    return
  }

  cleanups.get(el)?.()
}