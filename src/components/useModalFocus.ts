import { useLayoutEffect, useRef, type RefObject } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useModalFocus(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  closeDisabled = false,
  initialFocusRef?: RefObject<HTMLElement | null>,
  active = true,
) {
  const onCloseRef = useRef(onClose)
  const closeDisabledRef = useRef(closeDisabled)
  onCloseRef.current = onClose
  closeDisabledRef.current = closeDisabled

  useLayoutEffect(() => {
    if (!active) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = containerRef.current
    const initial = initialFocusRef?.current ?? container?.querySelector<HTMLElement>(focusableSelector)
    initial?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabledRef.current) {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !container) return
      const focusable = [...container.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter((element) => element.getAttribute('aria-hidden') !== 'true')
      if (!focusable.length) { event.preventDefault(); return }
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [active, containerRef, initialFocusRef])
}
