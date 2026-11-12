import { useEffect, useState } from "react"

export function useWidth() {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState<number>()
  useEffect(() => {
    if (!element) return
    // ast-grep-ignore: no-manual-scroll -- measures an element's width, not a chat
    const observer = new ResizeObserver((entries) => setWidth(entries.at(0)?.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, width] as const
}
