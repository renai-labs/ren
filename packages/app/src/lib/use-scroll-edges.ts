import { useEffect, useRef, useState } from "react"

export function useScrollEdges(options: { axis?: "x" | "y" } = {}) {
  const vertical = options.axis === "y"
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const board = ref.current
    if (!board) return
    const measure = () =>
      setEdges(
        vertical
          ? { start: board.scrollTop > 1, end: board.scrollTop + board.clientHeight < board.scrollHeight - 1 }
          : { start: board.scrollLeft > 1, end: board.scrollLeft + board.clientWidth < board.scrollWidth - 1 },
      )
    const wheel = (event: WheelEvent) => {
      if (vertical) return
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.shiftKey) return
      if (board.scrollHeight > board.clientHeight + 1) return
      board.scrollLeft += event.deltaY
    }
    measure()
    // ast-grep-ignore: no-manual-scroll -- measures the board to fade its scrollable edges, not a chat
    const observer = new ResizeObserver(measure)
    observer.observe(board)
    board.addEventListener("scroll", measure, { passive: true })
    board.addEventListener("wheel", wheel, { passive: true })
    return () => {
      observer.disconnect()
      board.removeEventListener("scroll", measure)
      board.removeEventListener("wheel", wheel)
    }
  }, [vertical])
  return [ref, edges] as const
}
