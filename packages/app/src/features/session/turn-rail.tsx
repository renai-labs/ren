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

// oxlint-disable-next-line ren/no-comments -- At rest the turn being read stands out; under the pointer the ticks swell around the hovered one.
const tickWidth = (index: number, marks: { readonly active: number | undefined; readonly current: number }) => {
  if (marks.active !== undefined) return widths[Math.abs(index - marks.active)] ?? "w-3"
  return index === marks.current ? "w-4" : "w-2.5"
}

const tickColor = (
  index: number,
  marks: { readonly active: number | undefined; readonly current: number },
  options: { seen: boolean },
) => {
  if (index === marks.active || index === marks.current) return "bg-foreground"
  return options.seen ? "bg-foreground/55" : "bg-muted-foreground/35"
}

export function TurnRail(props: { messages: ReadonlyArray<SessionMessage.Info> }) {
  const turns = turnsOf(props.messages)
  const [railRef, rail] = useTurnRail(turns.map((turn) => turn.id))
  const [active, setActive] = useState<number>()
  if (turns.length < 2) return null
  const last = turns.length - 1
  const reading = turns.findIndex((turn) => turn.id === rail.current)
  const marks = { active, current: reading }
  const focusable = active ?? (reading === -1 ? last : reading)
  // oxlint-disable-next-line ren/no-comments -- A nearby turn glides into place; a far one jumps, as a long glide is slow and would land on the wrong turn once older messages load above it.
  const jump = (id: string) => {
    const target = rail.scope()?.querySelector<HTMLElement>(turnSelector(id))
    const viewport = target?.closest<HTMLElement>("[data-slot=message-scroller-viewport]")
    if (!target || !viewport) return
    const distance = Math.abs(target.getBoundingClientRect().top - viewport.getBoundingClientRect().top)
    target.scrollIntoView({ behavior: distance < viewport.clientHeight * 1.5 ? "smooth" : "instant", block: "start" })
  }
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
      className="pointer-events-none absolute inset-y-0 left-3 z-10 flex flex-col justify-center max-md:hidden"
      // oxlint-disable-next-line ren/no-comments -- The rail floats over the chat, so a wheel over its ticks would scroll nothing; it scrolls the chat.
      onWheel={(event) =>
        rail
          .scope()
          ?.querySelector("[data-slot=message-scroller-viewport]")
          ?.scrollBy({ top: event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY })
      }
    >
      <div className="pointer-events-auto flex flex-col py-2 pr-3 pl-1">
        {turns.map((turn, index) => (
          <Button
            key={turn.id}
            variant="ghost"
            data-turn-tick
            tabIndex={index === focusable ? 0 : -1}
            aria-label={turn.prompt || "Message"}
            aria-current={index === reading ? "location" : undefined}
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
                tickWidth(index, marks),
                tickColor(index, marks, { seen: rail.inView.has(turn.id) }),
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
