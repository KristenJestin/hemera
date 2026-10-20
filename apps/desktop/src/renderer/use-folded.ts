import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'

/** The keystroke that folds and opens the sidebar, as its button's tooltip says: Ctrl+B. */
const isFoldKey = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === 'b'

/** Whether the sidebar is folded, and the keystroke that folds and opens it. */
export function useFolded(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [folded, setFolded] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isFoldKey(event)) return
      event.preventDefault()
      setFolded((before) => !before)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return [folded, setFolded]
}
