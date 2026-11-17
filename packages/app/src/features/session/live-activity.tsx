import type { Activity } from "@ren/chat"
import { IconArrowUpRight, IconBrain, IconDeviceDesktop, IconHandStop, IconPencil } from "@tabler/icons-react"
import { useState } from "react"
import { cn } from "cn"
import { AppIcon } from "../../components/app-icon.js"
import { useApp } from "../../lib/use-app.js"
import { useSteady } from "../../lib/use-steady.js"
import { toolIcons } from "./tool-icons.js"

export interface LiveLine {
  readonly text: string
  readonly kind: Activity.Line["kind"] | "starting" | "waiting"
  readonly app?: string | undefined
}

const icons = {
  ...toolIcons,
  thinking: IconBrain,
  writing: IconPencil,
  starting: IconDeviceDesktop,
  waiting: IconHandStop,
}

const keyOf = (line: LiveLine) => `${line.kind}:${line.app ?? ""}:${line.text}`

function LineIcon(props: { line: LiveLine }) {
  const app = useApp(props.line.app).app
  if (app) return <AppIcon name={app.name} icon={app.icon} className="size-4 rounded-sm" />
  const Icon = icons[props.line.kind]
  return <Icon className="size-4" />
}

// oxlint-disable-next-line ren/no-comments -- The one line a running turn shows: what Ren does now, in plain words. Each call gets its moment even when it ends between two updates; then the line shows the current state. The icon stays still, the words shimmer, and each line holds long enough to read.
export function LiveActivity(props: {
  line: LiveLine
  last?: { readonly id: string; readonly line: LiveLine } | undefined
  onOpen?: (() => void) | undefined
}) {
  const [seen, setSeen] = useState(() => props.last?.id)
  const last = props.last
  const fresh = last && last.id !== seen ? last : undefined
  const line = useSteady(fresh?.line ?? props.line, { key: keyOf, minMs: 700 })
  if (fresh && keyOf(line) === keyOf(fresh.line)) setSeen(fresh.id)
  const content = (
    <>
      <span
        key={`${line.kind}:${line.app ?? ""}`}
        aria-hidden
        className="flex size-4 shrink-0 animate-in items-center justify-center duration-200 ease-out fade-in-0 motion-reduce:animate-none"
      >
        <LineIcon line={line} />
      </span>
      <span
        key={line.text}
        className="min-w-0 animate-in truncate duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none"
      >
        <span className={cn(line.kind !== "waiting" && "shimmer motion-reduce:shimmer-none")}>{line.text}</span>
      </span>
    </>
  )
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      {props.onOpen ? (
        // oxlint-disable-next-line react/forbid-elements -- the whole line opens Progress; a Button would add padding and a fill the line must not have
        <button
          type="button"
          title="Open in Progress"
          className="group/live -mx-2 -my-1 flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left transition-[color,background-color,scale] duration-150 ease-out outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transition-colors motion-reduce:active:scale-100"
          onClick={props.onOpen}
        >
          {content}
          <IconArrowUpRight
            aria-hidden
            className="-ml-0.5 size-3.5 shrink-0 transition-[opacity,translate] duration-150 ease-out group-hover/live:translate-0 group-hover/live:opacity-100 group-focus-visible/live:translate-0 group-focus-visible/live:opacity-100 motion-reduce:transition-opacity pointer-fine:-translate-x-0.5 pointer-fine:translate-y-0.5 pointer-fine:opacity-0"
          />
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-2">{content}</span>
      )}
    </div>
  )
}
