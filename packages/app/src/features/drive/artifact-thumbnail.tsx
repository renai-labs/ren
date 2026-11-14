import type { ArtifactInfo } from "@ren/client"
import { cn } from "cn"

const tones = [
  { wash: "bg-chart-1/12", ink: "bg-chart-1" },
  { wash: "bg-chart-2/12", ink: "bg-chart-2" },
  { wash: "bg-chart-3/12", ink: "bg-chart-3" },
  { wash: "bg-chart-4/12", ink: "bg-chart-4" },
  { wash: "bg-chart-6/12", ink: "bg-chart-6" },
] as const

const hash = (value: string) =>
  Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)).reduce(
    (total, code) => (total * 31 + code) >>> 0,
    7,
  )

export function ArtifactThumbnail(props: { artifact: ArtifactInfo; className?: string | undefined }) {
  const tone = tones[hash(props.artifact.id) % tones.length] ?? tones[0]
  return (
    <div
      aria-hidden
      className={cn(
        "relative aspect-16/10 overflow-hidden",
        tone.wash,
        props.artifact.url === null && "grayscale",
        props.className,
      )}
    >
      <div className="absolute inset-x-[10%] top-[16%] -bottom-px flex flex-col gap-1 overflow-hidden rounded-t-sm bg-card p-1.5 shadow-sm ring-1 ring-foreground/5">
        <span className={cn("h-1 w-1/2 rounded-full", tone.ink)} />
        <span className="h-0.5 w-3/4 rounded-full bg-muted-foreground/25" />
        <span className={cn("flex-1 rounded-xs", tone.wash)} />
      </div>
    </div>
  )
}
