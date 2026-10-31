import { cn } from "cn"

function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span data-slot="color-dot" className={cn("size-2 rounded-full", className)} style={{ background: color }} />
}

export { ColorDot }
