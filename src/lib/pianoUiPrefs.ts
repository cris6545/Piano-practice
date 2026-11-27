const PIANO_COLLAPSED_KEY = 'pst-piano-collapsed'

export { PIANO_COLLAPSED_KEY }

export function isPianoKeyboardCollapsed(): boolean {
  try {
    return localStorage.getItem(PIANO_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function setPianoKeyboardCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(PIANO_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // private mode / quota
  }
}