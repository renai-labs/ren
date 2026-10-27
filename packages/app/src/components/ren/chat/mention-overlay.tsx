import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react"
import { MentionLogo } from "@/components/ren/app-mention"
import type { MentionMark } from "@/routes/chat/use-composer-suggestions"

const copied = [
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "tabSize",
] as const

interface Box {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly scroll: number
  readonly style: CSSProperties
}

export function MentionOverlay(props: {
  textarea: RefObject<HTMLTextAreaElement | null>
  text: string
  marks: ReadonlyArray<MentionMark>
}) {
  const [box, setBox] = useState<Box>()
  const textarea = props.textarea
  const active = props.marks.length > 0
  useLayoutEffect(() => {
    const node = textarea.current
    if (!node || !active) return
    const measure = () => {
      const computed = getComputedStyle(node)
      setBox({
        top: node.offsetTop,
        left: node.offsetLeft,
        width: node.clientWidth,
        height: node.clientHeight,
        scroll: node.scrollTop,
        style: Object.fromEntries(copied.map((key) => [key, computed[key]])),
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    node.addEventListener("scroll", measure, { passive: true })
    return () => {
      observer.disconnect()
      node.removeEventListener("scroll", measure)
    }
  }, [textarea, active])
  if (!box || props.marks.length === 0) return null
  const parts = props.marks.reduce<{ from: number; nodes: Array<{ key: string; text: string; mark?: MentionMark }> }>(
    (all, mark) => ({
      from: mark.end,
      nodes: [
        ...all.nodes,
        { key: `t${all.from}`, text: props.text.slice(all.from, mark.start) },
        { key: `m${mark.start}`, text: props.text.slice(mark.start, mark.end), mark },
      ],
    }),
    { from: 0, nodes: [] },
  )
  const nodes = [...parts.nodes, { key: `t${parts.from}`, text: `${props.text.slice(parts.from)}​` }]
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute overflow-hidden"
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
    >
      <div
        className="wrap-break-word whitespace-pre-wrap text-foreground"
        style={{ ...box.style, transform: `translateY(${-box.scroll}px)` }}
      >
        {nodes.map((node) =>
          node.mark ? (
            <span key={node.key} className="relative" style={{ color: node.mark.color }}>
              <span className="invisible">{node.text.slice(0, node.text.length - node.mark.label.length)}</span>
              <MentionLogo
                name={node.mark.label}
                icon={node.mark.icon}
                className="absolute top-1/2 left-0 -translate-y-1/2"
              />
              {node.mark.label}
            </span>
          ) : (
            <span key={node.key}>{node.text}</span>
          ),
        )}
      </div>
    </div>
  )
}
