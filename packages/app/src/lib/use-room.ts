import { useLayoutEffect, useState, type RefObject } from "react"

const margin = 12

const least = 120

const gap = 8

const enough = 220

const clipOf = (node: HTMLElement) => {
  const view = { top: 0, bottom: window.innerHeight }
  const walk = (element: HTMLElement | null): { top: number; bottom: number } => {
    if (!element) return view
    const style = getComputedStyle(element)
    if (style.overflowY === "visible" && style.overflowX === "visible") return walk(element.parentElement)
    const rect = element.getBoundingClientRect()
    return { top: Math.max(rect.top, view.top), bottom: Math.min(rect.bottom, view.bottom) }
  }
  return walk(node.parentElement)
}

export function useRoom(
  anchor: RefObject<HTMLElement | null>,
  options: { readonly open: boolean; readonly prefer: "below" | "above"; readonly want: number },
) {
  const [room, setRoom] = useState<{ readonly below: boolean; readonly height: number }>()
  const open = options.open
  const prefer = options.prefer
  const want = options.want
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const node = anchor.current
      if (!node) return
      const box = node.getBoundingClientRect()
      const frame = clipOf(node)
      const space = { below: frame.bottom - box.bottom - margin, above: box.top - frame.top - margin }
      const other = prefer === "below" ? "above" : "below"
      const side = space[prefer] >= Math.min(want, enough) || space[prefer] >= space[other] ? prefer : other
      const height = Math.max(least, Math.min(want, space[side] - gap))
      setRoom((current) =>
        current?.below === (side === "below") && current.height === height
          ? current
          : { below: side === "below", height },
      )
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, { capture: true, passive: true })
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, { capture: true })
    }
  }, [anchor, open, prefer, want])
  return open ? room : undefined
}
