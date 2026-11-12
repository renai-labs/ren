import type { ArtifactInfo } from "@ren/client"
import { cn } from "cn"
import { Artifacts } from "../lib/artifacts.js"

const tones = [
  { wash: "bg-chart-1/12", ink: "bg-chart-1", soft: "bg-chart-1/25", text: "text-chart-1" },
  { wash: "bg-chart-2/12", ink: "bg-chart-2", soft: "bg-chart-2/25", text: "text-chart-2" },
  { wash: "bg-chart-3/12", ink: "bg-chart-3", soft: "bg-chart-3/25", text: "text-chart-3" },
  { wash: "bg-chart-4/12", ink: "bg-chart-4", soft: "bg-chart-4/25", text: "text-chart-4" },
  { wash: "bg-chart-6/12", ink: "bg-chart-6", soft: "bg-chart-6/25", text: "text-chart-6" },
] as const

const hash = (value: string) =>
  Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)).reduce(
    (total, code) => (total * 31 + code) >>> 0,
    7,
  )

type Tone = (typeof tones)[number]

function PageLayout(props: { title: string; tone: Tone }) {
  return (
    <div className="flex flex-1 flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className={cn("h-1.5 w-8 rounded-full", props.tone.ink)} />
        <span className="flex gap-1">
          <span className="h-1 w-4 rounded-full bg-muted-foreground/25" />
          <span className="h-1 w-4 rounded-full bg-muted-foreground/25" />
          <span className="h-1 w-4 rounded-full bg-muted-foreground/25" />
        </span>
      </div>
      <div className={cn("flex flex-1 flex-col justify-center gap-1.5 rounded-md px-3 py-2", props.tone.wash)}>
        <span className={cn("line-clamp-2 text-xs/4 font-semibold", props.tone.text)}>{props.title}</span>
        <span className="h-1 w-1/2 rounded-full bg-muted-foreground/25" />
        <span className={cn("mt-1 h-2 w-8 rounded-full", props.tone.ink)} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <span className="h-4 rounded-sm bg-muted" />
        <span className="h-4 rounded-sm bg-muted" />
        <span className="h-4 rounded-sm bg-muted" />
      </div>
    </div>
  )
}

function AppLayout(props: { title: string; tone: Tone }) {
  return (
    <div className="flex flex-1">
      <div className="flex w-1/4 flex-col gap-1.5 border-r p-2">
        <span className={cn("mb-1 size-2.5 rounded-sm", props.tone.ink)} />
        <span className={cn("h-1 w-full rounded-full", props.tone.soft)} />
        <span className="h-1 w-3/4 rounded-full bg-muted-foreground/20" />
        <span className="h-1 w-5/6 rounded-full bg-muted-foreground/20" />
        <span className="h-1 w-2/3 rounded-full bg-muted-foreground/20" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="truncate text-2xs font-semibold text-foreground/80">{props.title}</span>
        <div className="grid grid-cols-3 gap-1.5">
          <span className={cn("h-5 rounded-sm", props.tone.wash)} />
          <span className="h-5 rounded-sm bg-muted" />
          <span className="h-5 rounded-sm bg-muted" />
        </div>
        <div className="flex flex-1 items-end gap-1 rounded-sm bg-muted/60 p-1.5">
          <span className={cn("h-1/3 flex-1 rounded-xs", props.tone.soft)} />
          <span className={cn("h-2/3 flex-1 rounded-xs", props.tone.soft)} />
          <span className={cn("h-1/2 flex-1 rounded-xs", props.tone.soft)} />
          <span className={cn("h-full flex-1 rounded-xs", props.tone.ink)} />
          <span className={cn("h-3/4 flex-1 rounded-xs", props.tone.soft)} />
        </div>
      </div>
    </div>
  )
}

function DocumentLayout(props: { title: string; tone: Tone }) {
  return (
    <div className="mx-auto flex w-3/4 flex-1 flex-col gap-1.5 py-3">
      <span className="line-clamp-2 text-xs/4 font-semibold text-foreground/80">{props.title}</span>
      <span className={cn("mb-1 h-0.5 w-6 rounded-full", props.tone.ink)} />
      <span className="h-1 w-full rounded-full bg-muted-foreground/20" />
      <span className="h-1 w-11/12 rounded-full bg-muted-foreground/20" />
      <span className="h-1 w-full rounded-full bg-muted-foreground/20" />
      <span className="h-1 w-2/3 rounded-full bg-muted-foreground/20" />
      <span className={cn("mt-1 h-6 w-full rounded-sm", props.tone.wash)} />
    </div>
  )
}

function Layout(props: { entry: string; seed: number; title: string; tone: Tone }) {
  if (props.entry.endsWith(".md")) return <DocumentLayout title={props.title} tone={props.tone} />
  if (props.seed % 2 === 0) return <PageLayout title={props.title} tone={props.tone} />
  return <AppLayout title={props.title} tone={props.tone} />
}

export function ArtifactPreview(props: {
  artifact: ArtifactInfo
  size: "card" | "thumbnail"
  className?: string | undefined
}) {
  const artifact = props.artifact
  const seed = hash(artifact.id)
  const tone = tones[seed % tones.length] ?? tones[0]
  const detailed = props.size === "card"
  const host = Artifacts.host(artifact.url)
  return (
    <div
      aria-hidden
      className={cn(
        "relative aspect-16/10 overflow-hidden",
        tone.wash,
        artifact.url === null && "grayscale",
        props.className,
      )}
    >
      <div
        className={cn(
          "absolute flex flex-col overflow-hidden bg-card shadow-sm ring-1 ring-foreground/5",
          detailed
            ? "inset-x-[8%] top-[10%] -bottom-px rounded-t-lg"
            : "inset-x-[10%] top-[16%] -bottom-px rounded-t-sm",
        )}
      >
        {detailed ? (
          <div className="flex h-5 shrink-0 items-center gap-1 border-b px-2">
            <span className="size-1.5 rounded-full bg-muted-foreground/25" />
            <span className="size-1.5 rounded-full bg-muted-foreground/25" />
            <span className="size-1.5 rounded-full bg-muted-foreground/25" />
            <span className="mx-auto max-w-2/3 truncate rounded-sm bg-muted px-2 text-2xs text-muted-foreground">
              {host ?? artifact.entry}
            </span>
          </div>
        ) : null}
        {detailed ? (
          <Layout entry={artifact.entry} seed={seed} title={artifact.title} tone={tone} />
        ) : (
          <div className="flex flex-1 flex-col gap-1 p-1.5">
            <span className={cn("h-1 w-1/2 rounded-full", tone.ink)} />
            <span className="h-0.5 w-3/4 rounded-full bg-muted-foreground/25" />
            <span className={cn("flex-1 rounded-xs", tone.wash)} />
          </div>
        )}
      </div>
    </div>
  )
}
