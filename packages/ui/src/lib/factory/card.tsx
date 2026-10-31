import { use, useState, type ReactNode } from "react"
import { cn } from "cn"
import { ColumnWidthContext } from "./context.js"
import type { CardModel } from "./board.js"
import { formatAge, formatClock24, formatElapsed, formatTokens, formatUsd } from "./format.js"
import type { Resolution } from "./types.js"
import {
  ArrowRight,
  ArrowUp,
  Check,
  Clock,
  Dollar,
  EmptyCircle,
  HalfCircle,
  Hand,
  Key,
  LinearLogo,
  Merge,
  PullRequest,
  RenLogo,
  SentryLogo,
  SlackLogo,
  Tokens,
  ThreeQuarterCircle,
} from "./icons.js"
import { Lattice } from "./lattice.js"

const STATUS_COLOR = "var(--f-build)"

const LABEL_COLOR: Record<string, string> = {
  api: "var(--f-green)",
  billing: "var(--f-teal)",
  bug: "var(--f-amber)",
  feature: "var(--f-teal)",
  web: "var(--f-amber)",
  docs: "var(--f-red)",
  perf: "var(--f-green)",
  "ren-fix": "var(--f-amber)",
  "ren-improve": "var(--f-green)",
  infra: "var(--f-teal)",
  ops: "var(--f-amber)",
  memory: "var(--f-plan)",
}

export type CardActions = {
  interactive: boolean
  onAct: (taskId: string, resolution: Resolution, note?: string) => void
  onOpen: (taskId: string) => void
}

export function FactoryCard({ card, actions }: { card: CardModel; actions: CardActions }) {
  const task = card.timeline.task
  const className = cn(
    "relative flex flex-col gap-2 overflow-clip f-card px-[14px] outline-none focus-visible:ring-2 focus-visible:ring-(--f-accent)",
    card.gate === "approve" || card.gate === "merge" || card.gate === "triage" ? "py-[20px]" : "py-4",
  )
  const body = (
    <>
      <CardHeader card={card} />
      {card.activity ? (
        <div className="-mt-1 pl-[22px]">
          <div key={card.activity} className="line-clamp-1 f-fade-in t-xs w-reg text-(--f-text-2)">
            {card.activity}
          </div>
        </div>
      ) : null}
      <div className={cn("flex min-h-[20px] items-center gap-2 pl-[22px]", card.gate === "account" && "pt-[10px]")}>
        <LabelPill label={task.label} />
        <CardMeta card={card} actions={actions} />
      </div>
      <CardButtons card={card} actions={actions} />
    </>
  )
  if (card.phase === "backlog") return <div className={className}>{body}</div>
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the card holds buttons, which an <a> cannot contain
      role="link"
      tabIndex={0}
      aria-label={`Open ${task.title}`}
      onClick={() => actions.onOpen(task.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") actions.onOpen(task.id)
      }}
      className={cn(className, "cursor-pointer")}
    >
      {body}
    </div>
  )
}

function CardHeader({ card }: { card: CardModel }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-[20px] items-center">
        <StatusIcon card={card} />
      </div>
      <div className={cn("min-w-0 grow t-sm w-med", "text-(--f-ink)")}>{card.timeline.task.title}</div>
      <div className={cn("flex items-center", card.phase === "working" ? "gap-2" : "gap-[6px]")}>
        {card.phase === "working" ? (
          <div className="flex h-[20px] shrink-0 items-center">
            <Lattice />
          </div>
        ) : null}
        {card.phase === "waiting" ? (
          <div className="flex h-[20px] items-center">
            <Hand />
          </div>
        ) : null}
        <RefChip card={card} />
      </div>
    </div>
  )
}

function CardMeta({ card, actions }: { card: CardModel; actions: CardActions }) {
  if (card.phase === "backlog") return <BacklogMeta card={card} actions={actions} />
  if (card.phase === "queued") {
    return (
      <>
        <div className="grow" />
        <Muted>{startsLabel(card)}</Muted>
      </>
    )
  }
  return (
    <>
      <div className="grow" />
      {card.gate === "triage" ? null : <Metrics card={card} reserve={card.gate === "account" ? 112 : 0} />}
      {card.gate === "account" ? (
        <ActionButton
          variant="ring"
          grow={false}
          disabled={!actions.interactive}
          onClick={() => actions.onAct(card.id, "account")}
          icon={<Key />}
        >
          Add account
        </ActionButton>
      ) : null}
    </>
  )
}

function CardButtons({ card, actions }: { card: CardModel; actions: CardActions }) {
  const act = (resolution: Resolution, note?: string) => actions.onAct(card.id, resolution, note)
  if (card.gate === "approve") {
    return (
      <ButtonRow>
        <ActionButton variant="ring" disabled={!actions.interactive} onClick={() => act("request_changes")}>
          Request changes
        </ActionButton>
        <ActionButton variant="strong" disabled={!actions.interactive} onClick={() => act("approve")} icon={<Check />}>
          Approve
        </ActionButton>
      </ButtonRow>
    )
  }
  if (card.gate === "merge") {
    return (
      <ButtonRow>
        <ActionButton variant="ring" onClick={() => actions.onOpen(card.id)}>
          Open PR
        </ActionButton>
        <ActionButton variant="strong" disabled={!actions.interactive} onClick={() => act("merge")} icon={<Merge />}>
          Merge
        </ActionButton>
      </ButtonRow>
    )
  }
  if (card.gate === "triage") {
    return (
      <ButtonRow>
        <ActionButton variant="ring" disabled={!actions.interactive} onClick={() => act("dismiss")}>
          Dismiss
        </ActionButton>
        <ActionButton
          variant="strong"
          disabled={!actions.interactive}
          onClick={() => act("send_to_plan")}
          icon={<ArrowRight />}
        >
          Send to Plan
        </ActionButton>
      </ButtonRow>
    )
  }
  if (card.gate === "hint") return <HintInput disabled={!actions.interactive} onSubmit={(note) => act("hint", note)} />
  return null
}

function startsLabel(card: CardModel): string {
  if (!card.startsAt) return "Starts soon"
  if (card.scheduled) return `Starts ${formatClock24(card.startsAt)}`
  const ms = card.startsAt - card.at
  return `Starts ~${formatElapsed(Math.max(60_000, ms))}`
}

function StatusIcon({ card }: { card: CardModel }) {
  if (card.phase === "backlog") return <EmptyCircle />
  if (card.phase === "queued") return <QueueNumber value={card.queueIndex ?? 1} />
  if (card.gate === "merge") return <ThreeQuarterCircle color={STATUS_COLOR} />
  return <HalfCircle color={STATUS_COLOR} />
}

function QueueNumber({ value }: { value: number }) {
  return (
    <div className="flex size-[14px] shrink-0 items-center justify-center rounded-full shadow-[var(--f-text-2)_0px_0px_0px_1.3px_inset]">
      <div className="w-max tnum text-[9px] leading-[10px] w-semi text-(--f-ink)">{value}</div>
    </div>
  )
}

function RefChip({ card }: { card: CardModel }) {
  const timeline = card.timeline
  const source = timeline.task.source
  const showPr = timeline.pr && card.stage !== "plan" && card.stage !== "backlog" && timeline.task.kind !== "alert"
  if (showPr) return <Chip icon={<PullRequest />}>#{timeline.pr}</Chip>
  if (source.kind === "ren") return null
  if (source.kind === "linear") return <Chip icon={<LinearLogo />}>{source.ref}</Chip>
  if (source.kind === "sentry") return <Chip icon={<SentryLogo />}>{source.ref}</Chip>
  return <Chip icon={<SlackLogo />}>{source.ref}</Chip>
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-[20px] shrink-0 items-center gap-1 rounded-md px-[6px] f-ring">
      {icon}
      <div className="w-max tnum t-xs w-med text-(--f-ink)">{children}</div>
    </div>
  )
}

function LabelPill({ label }: { label: string }) {
  return (
    <div className="flex h-[20px] shrink-0 items-center gap-[6px] rounded-full px-2 f-ring">
      <div className="size-2 shrink-0 rounded-full" style={{ background: LABEL_COLOR[label] ?? "var(--f-teal)" }} />
      <div className="w-max t-xs w-med text-(--f-ink)">{label}</div>
    </div>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <div className="w-max tnum t-xs w-reg text-(--f-text-2)">{children}</div>
}

function Metric({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      {icon}
      <Muted>{children}</Muted>
    </div>
  )
}

const CHAR = 6.7

function textWidth(text: string) {
  return text.length * CHAR
}

function Metrics({ card, reserve = 0 }: { card: CardModel; reserve?: number }) {
  const elapsed = card.elapsedMs >= 10 * 60 * 60_000 ? formatAge(card.elapsedMs) : formatElapsed(card.elapsedMs)
  const metrics = [
    { key: "time", icon: <Clock />, text: elapsed },
    { key: "cost", icon: <Dollar />, text: formatUsd(card.costUsd) },
    { key: "tokens", icon: <Tokens />, text: formatTokens(card.tokens) },
  ]
  const rowWidth = use(ColumnWidthContext) - 28 - 22
  const label = 30 + textWidth(card.timeline.task.label)
  const width = (items: typeof metrics) => items.reduce((sum, item) => sum + 16 + textWidth(item.text) + 10, 0)
  let shown = metrics
  while (shown.length > 1 && label + 8 + width(shown) + reserve > rowWidth) shown = shown.slice(0, -1)
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-[10px]">
      {shown.map((item) => (
        <Metric key={item.key} icon={item.icon}>
          {item.text}
        </Metric>
      ))}
    </div>
  )
}

function BacklogMeta({ card, actions }: { card: CardModel; actions: CardActions }) {
  const age = formatAge(card.elapsedMs)
  return (
    <>
      {card.timeline.task.source.kind === "ren" ? (
        <div className="flex shrink-0 items-center gap-[5px]">
          <RenLogo />
          <Muted>{age}</Muted>
        </div>
      ) : (
        <Muted>{age}</Muted>
      )}
      <div className="grow" />
      <button
        type="button"
        aria-label={`Send ${card.timeline.task.title} to Plan`}
        disabled={!actions.interactive}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          actions.onAct(card.id, "promote")
        }}
        className="flex size-6 shrink-0 f-press items-center justify-center rounded-md bg-(--f-fill-2) f-press-fill"
      >
        <ArrowRight />
      </button>
    </>
  )
}

function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-[6px] pt-[10px] pl-[22px]">{children}</div>
}

function ActionButton({
  variant,
  children,
  icon,
  onClick,
  disabled,
  grow = true,
}: {
  variant: "ring" | "strong"
  children: ReactNode
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
  grow?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex h-6 f-press items-center justify-center gap-1 rounded-md px-2",
        grow && "grow basis-0",
        variant === "ring" ? "f-ring f-press-ring" : "bg-(--f-fill-strong) f-press-strong",
      )}
    >
      {icon}
      <span className="w-max t-xs w-med text-(--f-ink)">{children}</span>
    </button>
  )
}

function HintInput({ disabled, onSubmit }: { disabled: boolean; onSubmit: (note: string) => void }) {
  const [value, setValue] = useState("")
  const submit = () => {
    const note = value.trim()
    if (!note || disabled) return
    onSubmit(note)
    setValue("")
  }
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- keeps clicks in the hint field from opening the card
    <div className="flex min-w-0 pt-[10px] pl-[22px]" onClick={(event) => event.stopPropagation()}>
      <form
        className="flex h-[28px] min-w-0 grow items-center gap-2 rounded-md pr-1 pl-2 f-ring"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Give Build a hint to unblock it…"
          aria-label="Hint for Build"
          // oxlint-disable-next-line ren/require-companion-class -- the caret marks focus in this text field
          className="w-0 min-w-0 grow bg-transparent t-xs w-reg text-(--f-text-1) outline-none placeholder:text-(--f-text-2)"
        />
        <button
          type="submit"
          aria-label="Send hint"
          disabled={disabled}
          className="flex size-[20px] shrink-0 f-press items-center justify-center rounded-[5px] bg-(--f-fill-strong) f-press-strong"
        >
          <ArrowUp />
        </button>
      </form>
    </div>
  )
}
