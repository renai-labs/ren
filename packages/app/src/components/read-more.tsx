import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "@ren/ui/button"
import { cn } from "cn"

// oxlint-disable-next-line ren/no-comments -- Long text shows its first three lines and a Read more button; text that fits shows no button.
export function ReadMore(props: { children: ReactNode; className?: string | undefined }) {
  const [open, setOpen] = useState(false)
  const [long, setLong] = useState(false)
  const text = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = text.current
    if (!element || open) return
    const measure = () => setLong(element.scrollHeight > element.clientHeight + 1)
    // ast-grep-ignore: no-manual-scroll -- measures whether the clamped text hides lines, not a chat
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [open])
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <div ref={text} className={cn(props.className, !open && "line-clamp-3")}>
        {props.children}
      </div>
      {long || open ? (
        <Button
          variant="link"
          size="sm"
          aria-expanded={open}
          className="h-auto px-0 text-foreground"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Show less" : "Read more"}
        </Button>
      ) : null}
    </div>
  )
}
