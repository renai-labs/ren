import { useState } from "react"

// oxlint-disable-next-line ren/no-comments -- True once the element has come near the viewport, and it stays true: work that only shows on screen (a signed link for a thumbnail) waits until then instead of running for every file in a long chat.
export function useSeen(margin = "800px") {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined")
  const observe = (node: Element | null) => {
    if (!node || seen) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setSeen(true)
        observer.disconnect()
      },
      { rootMargin: margin },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }
  return { observe, seen }
}
