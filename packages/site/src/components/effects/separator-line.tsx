import { cn } from "../../lib/utils.js"

export function SeparatorLine({ className }: { className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div className="h-px w-full bg-black" />
      <div className="h-px w-full bg-tint-5" />
    </div>
  )
}
