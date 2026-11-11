import { useState, type KeyboardEvent } from "react"
import type { SessionMessage } from "@ren/schema/session/message"
import { cn } from "cn"
import { Button } from "@ren/ui/button"
import { turnSelector, useTurnRail } from "../../lib/use-turn-rail.js"

type Turn = { readonly id: string; readonly prompt: string; readonly reply: string }

const clean = (text: string) => text.replaceAll(/\s+/gu, " ").trim()

const replyOf = (messages: ReadonlyArray<SessionMessage.Info>) =>
  clean(
    messages
      .flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
          : [],
      )
      .join(" "),
  )

const turnsOf = (messages: ReadonlyArray<SessionMessage.Info>): Turn[] => {
  const starts = messages.flatMap((message, index) => (message.type === "user" ? [index] : []))
  return starts.flatMap((start, at) => {
    const message = messages[start]
    if (message?.type !== "user") return []
    return [{ id: message.id, prompt: clean(message.text), reply: replyOf(messages.slice(start + 1, starts[at + 1])) }]
  })
}

const widths = ["w-6", "w-5", "w-4"] as const

const tickWidth = (index: number, active: number | undefined) =>
  active === undefined ? "w-2.5" : (widths[Math.abs(index - active)] ?? "w-3")

const tickColor = (index: number, active: number | undefined, options: { seen: boolean }) => {
  if (index === active) return "bg-foreground"
  return options.seen ? "bg-foreground/55" : "bg-muted-foreground/35"
}

export function TurnRail(props: { messages: ReadonlyArray<SessionMessage.Info> }) {
  const turns = turnsOf(props.messages)
  const [railRef, rail] = useTurnRail(turns.map((turn) => turn.id))
  const [active, setActive] = useState<number>()
  if (turns.length < 2) return null
  const last = turns.length - 1
  const focusable = active ?? last
  const jump = (id: string) =>
    rail.scope()?.querySelector(turnSelector(id))?.scrollIntoView({ behavior: "smooth", block: "start" })
  const keys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (step !== undefined) {
      event.preventDefault()
      const next = Math.min(last, Math.max(0, index + step))
      setActive(next)
      rail.focus(next)
    }
    if (event.key === "Escape") event.currentTarget.blur()
  }
  return (
    <nav
      ref={railRef}
      aria-label="Jump to a message (Alt+J)"
      className="pointer-events-none absolute inset-y-0 left-[max(--spacing(2),calc(50%_-_var(--container-chat)/2_-_--spacing(10)))] z-10 flex flex-col justify-center max-md:hidden"
    >
      <div className="pointer-events-auto flex flex-col py-2 pr-3 pl-1">
        {turns.map((turn, index) => (
          <Button
            key={turn.id}
            variant="ghost"
            data-turn-tick
            tabIndex={index === focusable ? 0 : -1}
            aria-label={turn.prompt || "Message"}
            className="relative flex h-2.5 w-auto justify-start rounded-sm border-0 p-0 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50 active:not-aria-[haspopup]:scale-100"
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(undefined)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(undefined)}
            onKeyDown={(event) => keys(event, index)}
            onClick={() => jump(turn.id)}
          >
            <span
              className={cn(
                "h-0.5 rounded-full transition-[width,background-color] duration-150 ease-out motion-reduce:transition-none",
                tickWidth(index, active),
                tickColor(index, active, { seen: rail.inView.has(turn.id) }),
              )}
            />
            {index === active ? (
              <span className="absolute top-1/2 left-full ml-4 flex w-80 -translate-y-1/2 animate-in flex-col gap-1 rounded-xl border bg-popover p-3 text-left font-normal whitespace-normal shadow-overlay duration-100 fade-in-0">
                <span className="truncate text-sm font-medium text-foreground">{turn.prompt || "Message"}</span>
                {turn.reply ? <span className="line-clamp-3 text-sm text-muted-foreground">{turn.reply}</span> : null}
              </span>
            ) : null}
          </Button>
        ))}
      </div>
    </nav>
  )
}
