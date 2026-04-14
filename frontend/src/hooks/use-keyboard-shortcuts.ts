import { useEffect } from 'react'
import { useStore } from '@/store/use-store'

export function useKeyboardShortcuts() {
  const { toggleSidebar, toggleWorkspace } = useStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // CMD/CTRL check
      const isMod = e.metaKey || e.ctrlKey

      // CMD/CTRL + B: Toggle Left Sidebar
      if (isMod && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
        return
      }

      // CMD/CTRL + SHIFT + B: Toggle Right Sidebar (Workspace)
      if (isMod && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleWorkspace()
        return
      }

      // / : Focus Chat Input
      // Only focus if not already in an input/textarea
      if (
        e.key === '/' &&
        !(document.activeElement instanceof HTMLInputElement) &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault()
        const textarea = document.querySelector('textarea')
        if (textarea instanceof HTMLTextAreaElement) {
          textarea.focus()
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebar, toggleWorkspace])
}
