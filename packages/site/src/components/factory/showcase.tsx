import { Tabs } from "@base-ui/react/tabs"
import { useEffect, useState } from "react"
import { HOUR } from "../../lib/factory/time.js"
import { FactoryAnalytics } from "./analytics.js"
import { FactoryBoard } from "./board.js"

const SHOWCASE_SPEED = 20
const SHOWCASE_REPLAY = 6 * HOUR
const SHOWCASE_MAX_IDLE_MS = 1200

const VIEWS = [
  { value: "board", label: "Board" },
  { value: "dashboard", label: "Dashboard" },
] as const

type View = (typeof VIEWS)[number]["value"]

const PILL =
  "relative flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium text-muted-foreground outline-none transition-colors-quick hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-active:bg-tint-5 data-active:text-foreground"

function GlowDot() {
  return (
    <span aria-hidden className="relative flex size-1.5">
      <span className="absolute inset-0 rounded-full bg-brand opacity-75 motion-safe:animate-ping" />
      <span className="relative size-1.5 rounded-full bg-brand shadow-[0_0_8px_2px_var(--brand)]" />
    </span>
  )
}

const COMPACT_QUERY = "(max-width: 767px)"

function useCompact() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY)
    const update = () => setCompact(query.matches)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return compact
}

export function FactoryShowcase() {
  const compact = useCompact()
  const [view, setView] = useState<View>("board")
  const [seen, setSeen] = useState(false)
  // oxlint-disable-next-line react/hook-use-state -- the replay starts from the mount time and never moves
  const [playFrom] = useState(() => Date.now() - SHOWCASE_REPLAY)

  const select = (value: unknown) => {
    const next = VIEWS.find((item) => item.value === value)?.value
    if (!next) return
    setView(next)
    if (next === "dashboard") setSeen(true)
  }

  return (
    <Tabs.Root value={view} onValueChange={select} className="flex flex-col gap-4">
      <Tabs.List aria-label="Factory views" className="flex items-center gap-1">
        {VIEWS.map((item) => (
          <Tabs.Tab key={item.value} value={item.value} className={PILL}>
            {item.label}
            {item.value === "dashboard" && !seen ? <GlowDot /> : null}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <div className="overflow-hidden rounded-2xl shadow-[0_0_0_1px_var(--line-chrome)]">
        <Tabs.Panel
          value="board"
          className="h-[600px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:h-[720px]"
        >
          <FactoryBoard
            compact={compact}
            startAt="plan"
            timeline={{
              playFrom,
              speed: SHOWCASE_SPEED,
              keyboard: false,
              loop: true,
              maxIdleMs: SHOWCASE_MAX_IDLE_MS,
            }}
          />
        </Tabs.Panel>
        <Tabs.Panel
          value="dashboard"
          className="outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:h-[720px]"
        >
          <FactoryAnalytics compact={compact} />
        </Tabs.Panel>
      </div>
    </Tabs.Root>
  )
}
