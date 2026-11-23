import { useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { IconCheck, IconChevronDown, IconChevronRight } from "@tabler/icons-react"
import type { SessionModel as ModelSetting } from "@ren/client"
import type { SessionModel } from "@ren/schema/session/model"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { InputGroupButton } from "@ren/ui/input-group"
import { Popover, PopoverContent } from "@ren/ui/popover"
import { Separator } from "@ren/ui/separator"
import { Loading } from "@ren/ui/loading"
import { cn } from "cn"
import { ChatPreferences } from "../lib/chat-preferences.js"
import { modelKey } from "../lib/format.js"
import { Preference } from "../lib/preference.js"
import { PaletteDialog, PaletteEmpty, PaletteHeading } from "./palette.js"

type Choice = SessionModel.Choice

export const modelRef = (model: ModelSetting): SessionModel.Ref => ({
  id: model.modelId,
  providerID: model.endpointId,
  ...(model.variant && { variant: model.variant }),
})

export const modelSetting = (model: SessionModel.Ref): ModelSetting => ({
  endpointId: model.providerID,
  modelId: model.id,
  ...(model.variant && { variant: model.variant }),
})

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

const effortOrder = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]

const effortRank = (id: string) => {
  const index = effortOrder.indexOf(id)
  return index === -1 ? effortOrder.length : index
}

const effortLabel = (id: string) => (id === "xhigh" ? "Extra high" : capitalize(id))

const effortsOf = (model: Choice) =>
  model.variants.map((each) => each.id).toSorted((a, b) => effortRank(a) - effortRank(b))

function defaultEffort(efforts: ReadonlyArray<string>, variant: string | undefined) {
  if (variant && efforts.includes(variant)) return variant
  if (efforts.includes("medium")) return "medium"
  return efforts[0]
}

export function pickModel(
  models: ReadonlyArray<Choice>,
  picks: ReadonlyArray<SessionModel.Ref | null | undefined>,
): SessionModel.Ref | undefined {
  const found = picks.find((pick) => pick && models.some((model) => modelKey(model) === modelKey(pick)))
  const choice = found ? models.find((model) => modelKey(model) === modelKey(found)) : models.at(0)
  if (!choice) return undefined
  const variant = found?.variant ?? defaultEffort(effortsOf(choice), undefined)
  return { id: choice.id, providerID: choice.providerID, ...(variant && { variant }) }
}

// oxlint-disable-next-line ren/no-comments -- Providers P24: only Anthropic and OpenAI have two methods, so only their rows say which one serves.
const twoMethods = new Set(["anthropic", "openai", "claude-agent"])

const cardOf = (model: Choice) => model.providerName ?? capitalize(model.providerID)

const cardLabel = (model: Choice) =>
  model.method && twoMethods.has(model.providerID)
    ? `${cardOf(model)} (${model.method === "subscription" ? "subscription" : "key"})`
    : cardOf(model)

const perMillion = (value: number) => `$${value < 10 ? value.toFixed(2).replace(/\.?0+$/u, "") : Math.round(value)}`

const priceLabel = (model: Choice) => {
  if (model.free) return "Free"
  return model.price && `${perMillion(model.price.input)} / ${perMillion(model.price.output)}`
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replaceAll(/\s+/gu, " ")

const matches = (query: string, model: Choice) => {
  const search = normalize(query)
  if (!search) return true
  const compact = search.replaceAll(" ", "")
  return [model.name, model.id, cardLabel(model)].some(
    (value) => normalize(value).includes(search) || normalize(value).replaceAll(" ", "").includes(compact),
  )
}

const cardRank = (card: string) => (card === "Ren" ? 0 : 1)

interface Group {
  readonly key: string
  readonly title: string
  readonly section: boolean
  readonly models: ReadonlyArray<Choice>
}

const groupsOf = (
  models: ReadonlyArray<Choice>,
  input: { readonly query: string; readonly recent: ReadonlyArray<string> },
): ReadonlyArray<Group> => {
  const shown = models.filter((model) => matches(input.query, model)).toSorted((a, b) => a.name.localeCompare(b.name))
  const byKey = new Map(shown.map((model) => [modelKey(model), model]))
  const searching = input.query.trim() !== ""
  const recent = searching ? [] : input.recent.flatMap((key) => byKey.get(key) ?? [])
  const listed = new Set(recent.map(modelKey))
  const byCard = Map.groupBy(
    shown.filter((model) => !listed.has(modelKey(model))),
    cardLabel,
  )
  const cards = [...byCard.keys()].toSorted((a, b) => cardRank(a) - cardRank(b) || a.localeCompare(b))
  return [
    ...(recent.length ? [{ key: "recent", title: "Recent", section: true, models: recent }] : []),
    ...cards.flatMap((card) => {
      const own = byCard.get(card) ?? []
      return own.length ? [{ key: card, title: card, section: false, models: own }] : []
    }),
  ]
}

function Highlight(props: { text: string; query: string }) {
  const query = props.query.trim().toLowerCase()
  const at = query ? props.text.toLowerCase().indexOf(query) : -1
  if (at === -1) return props.text
  return (
    <>
      {props.text.slice(0, at)}
      <span className="text-link">{props.text.slice(at, at + query.length)}</span>
      {props.text.slice(at + query.length)}
    </>
  )
}

interface Picker {
  readonly current: Choice
  readonly variant: string | undefined
  readonly isCurrent: (model: Choice) => boolean
  readonly variantOf: (model: Choice) => string | undefined
  readonly pick: (model: Choice, variant?: string) => void
}

const usePicker = (
  models: ReadonlyArray<Choice>,
  value: SessionModel.Ref | undefined,
  onChange: (model: SessionModel.Ref) => void,
): Picker | undefined => {
  const recent = Preference.usePreference(ChatPreferences.modelRecent)
  const setPreference = Preference.useSetPreference()
  const key = value ? modelKey(value) : undefined
  const current = models.find((model) => modelKey(model) === key)
  if (!current) return undefined
  const variant = value?.variant ?? current.variants.at(0)?.id
  return {
    current,
    variant,
    isCurrent: (model) => modelKey(model) === key,
    variantOf: (model) => (modelKey(model) === key ? variant : defaultEffort(effortsOf(model), undefined)),
    pick: (model, next) => {
      const chosen = next ?? defaultEffort(effortsOf(model), modelKey(model) === key ? variant : undefined)
      setPreference(
        ChatPreferences.modelRecent,
        [modelKey(model), ...recent.filter((each) => each !== modelKey(model))].slice(0, 5),
      )
      onChange({ id: model.id, providerID: model.providerID, ...(chosen && { variant: chosen }) })
    },
  }
}

const chipClass = "min-w-0 justify-start font-normal text-muted-foreground"

function ModelChip(props: { picker: Picker; disabled?: boolean | undefined; onOpen: () => void }) {
  const current = props.picker.current
  return (
    <InputGroupButton
      size="sm"
      disabled={props.disabled}
      aria-label={`Choose model, ${props.picker.current.name}`}
      aria-haspopup="dialog"
      className={cn(chipClass, "max-w-72 shrink")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onOpen}
    >
      <span className="flex min-w-0 whitespace-nowrap">
        <bdi className="min-w-0 truncate">{current.name}</bdi>
        <span aria-hidden className="mx-1 text-muted-foreground/40">
          ·
        </span>
        <bdi className="min-w-0 shrink-2 truncate text-muted-foreground/60">
          {cardLabel(current)}
          {current.free ? " · Free" : ""}
        </bdi>
      </span>
      <IconChevronDown className="-mr-1 -ml-0.5" />
    </InputGroupButton>
  )
}

function EffortChip(props: { picker: Picker; disabled?: boolean | undefined }) {
  const efforts = effortsOf(props.picker.current)
  const variant = props.picker.variant
  if (efforts.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={props.disabled}
        render={<InputGroupButton size="sm" aria-label="Choose effort" className={chipClass} />}
      >
        <span className="truncate">{variant ? effortLabel(variant) : "Default"}</span>
        <IconChevronDown className="-mr-1 -ml-0.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-auto min-w-36">
        <DropdownMenuRadioGroup
          value={variant ?? ""}
          onValueChange={(value: string) => props.picker.pick(props.picker.current, value)}
        >
          {efforts.map((effort) => (
            <DropdownMenuRadioItem key={effort} value={effort} closeOnClick>
              {effortLabel(effort)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface Row {
  readonly key: string
  readonly model: Choice
  readonly group: Group
}

const aimDelay = 120

function FlyoutItem(props: { checked?: boolean | undefined; onClick: () => void; children: ReactNode }) {
  return (
    // oxlint-disable-next-line react/forbid-elements -- a menu row in the model flyout, laid out as OpenCode's
    <button
      type="button"
      role={props.checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={props.checked}
      className="flex h-7 w-full items-center justify-between gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

const tokens = (count: number) =>
  count >= 1_000_000 ? `${Math.round(count / 100_000) / 10}M` : `${Math.round(count / 1000)}K`

function Details(props: { model: Choice | SessionModel.Info }) {
  const model = props.model
  const context = "limit" in model ? model.limit.context : 0
  const input = "input" in model ? model.input.map(capitalize).join(", ") : ""
  return (
    <div className="flex flex-col px-2 py-1.5 text-xs/4 text-muted-foreground select-none">
      <span className="truncate">
        {cardLabel(model)}
        {priceLabel(model) ? ` · ${priceLabel(model)}` : ""}
        {context > 0 ? ` · ${tokens(context)} context` : ""}
      </span>
      {input ? <span className="truncate">{input}</span> : null}
    </div>
  )
}

function Flyout(props: {
  row: Row
  anchor: HTMLElement
  staged: string | undefined
  onPick: (variant: string | undefined) => void
  onEnter: () => void
  onLeave: () => void
}) {
  const efforts = effortsOf(props.row.model)
  return (
    <Popover open>
      <PopoverContent
        anchor={props.anchor}
        side="right"
        align="start"
        alignOffset={-2}
        sideOffset={10}
        initialFocus={false}
        finalFocus={false}
        aria-label={`${props.row.model.name} options`}
        className="w-44 gap-0 p-0.5 duration-0"
        onPointerEnter={props.onEnter}
        onPointerLeave={props.onLeave}
      >
        {efforts.map((effort) => (
          <FlyoutItem key={effort} checked={props.staged === effort} onClick={() => props.onPick(effort)}>
            {effortLabel(effort)}
            {props.staged === effort ? <IconCheck className="size-3.5" /> : null}
          </FlyoutItem>
        ))}
        {efforts.length ? <Separator className="my-0.5" /> : null}
        <Details model={props.row.model} />
      </PopoverContent>
    </Popover>
  )
}

function ModelRow(props: {
  row: Row
  query: string
  active: boolean
  selected: boolean
  effort: string | undefined
  onHover: (row: Row, element: HTMLElement, options: { aiming: boolean }) => void
  onPick: () => void
}) {
  const row = props.row
  return (
    // oxlint-disable-next-line react/forbid-elements -- a row of the model list, laid out as OpenCode's
    <button
      type="button"
      data-row={row.key}
      data-active={props.active || undefined}
      aria-current={props.selected || undefined}
      tabIndex={-1}
      className="flex h-7 w-full shrink-0 scroll-mt-8 items-center gap-1.5 rounded-md pr-0.75 pl-1.5 text-left text-sm outline-none focus-visible:bg-foreground/6 data-active:bg-foreground/6"
      onMouseMove={(event) => {
        if (event.movementX !== 0 || event.movementY !== 0)
          props.onHover(row, event.currentTarget, { aiming: event.movementX > Math.abs(event.movementY) })
      }}
      onClick={props.onPick}
    >
      <span className="flex w-4 shrink-0 justify-center">
        {props.selected ? <IconCheck className="size-3 text-muted-foreground" /> : null}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate">
          <Highlight text={row.model.name} query={props.query} />
        </span>
        {row.group.section ? (
          <span className="min-w-0 shrink-999 truncate text-muted-foreground">{cardLabel(row.model)}</span>
        ) : null}
        {priceLabel(row.model) ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{priceLabel(row.model)}</span>
        ) : null}
      </span>
      {props.active && props.effort ? (
        <span className="flex max-w-30 shrink-0 items-center gap-1 text-foreground/85">
          <span className="truncate">{effortLabel(props.effort)}</span>
          <IconChevronRight className="size-3 text-muted-foreground/70" />
        </span>
      ) : null}
    </button>
  )
}

function ModelDialog(props: {
  models: ReadonlyArray<Choice>
  picker: Picker
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const recent = Preference.usePreference(ChatPreferences.modelRecent)
  const [query, setQuery] = useState("")
  const [navigated, setNavigated] = useState(false)
  const [active, setActive] = useState<string>()
  const [staged, setStaged] = useState<Readonly<Record<string, string>>>({})
  const [flyout, setFlyout] = useState<{ readonly row: Row; readonly anchor: HTMLElement }>()
  const list = useRef<HTMLDivElement>(null)
  const timer = useRef<number>(undefined)
  const keyboard = useRef(false)
  const pending = useRef<HTMLElement>(undefined)
  const pointer = useRef<{ readonly x: number; readonly y: number }>(undefined)
  const groups = groupsOf(props.models, {
    query,
    recent: [modelKey(props.picker.current), ...recent.filter((key) => key !== modelKey(props.picker.current))],
  })
  const rows = groups.flatMap((group) => group.models.map((model): Row => ({ key: modelKey(model), model, group })))
  const current =
    rows.find((row) => row.key === active) ?? rows.find((row) => props.picker.isCurrent(row.model)) ?? rows.at(0)
  const effortOf = (model: Choice) => staged[modelKey(model)] ?? props.picker.variantOf(model)
  const close = () => {
    window.clearTimeout(timer.current)
    setFlyout(undefined)
  }
  const choose = (row: Row, variant?: string) => {
    close()
    props.picker.pick(row.model, variant ?? effortOf(row.model))
    props.onOpenChange(false)
  }
  const reveal = (row: Row) =>
    requestAnimationFrame(() => {
      const element = list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(row.key)}"]`)
      element?.scrollIntoView({ block: "nearest" })
      if (element) setFlyout({ row, anchor: element })
    })
  const move = (delta: number) => {
    if (rows.length === 0) return
    const index = current ? rows.indexOf(current) : -1
    const next = rows.at((index + delta + rows.length) % rows.length)
    if (!next) return
    setActive(next.key)
    setNavigated(true)
    keyboard.current = true
    window.clearTimeout(timer.current)
    reveal(next)
  }
  const step = (direction: 1 | -1) => {
    const efforts = current ? effortsOf(current.model) : []
    if (!current || efforts.length === 0) return false
    const index = efforts.indexOf(effortOf(current.model) ?? "")
    const next = efforts.at((index + direction + efforts.length) % efforts.length)
    if (next) setStaged({ ...staged, [current.key]: next })
    return true
  }
  const keys: Readonly<Record<string, (event: KeyboardEvent<HTMLInputElement>) => boolean>> = {
    ArrowDown: () => (move(1), true),
    ArrowUp: () => (move(-1), true),
    Enter: (event) => Boolean(current && !event.nativeEvent.isComposing && (choose(current), true)),
    ArrowRight: () => (!query || navigated) && step(1),
    ArrowLeft: () => (!query || navigated) && step(-1),
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (keys[event.key]?.(event)) event.preventDefault()
  }
  const hover = (row: Row, element: HTMLElement, options: { aiming: boolean }) => {
    keyboard.current = false
    if (pending.current === element) return
    window.clearTimeout(timer.current)
    pending.current = undefined
    const show = () => {
      pending.current = undefined
      setActive(row.key)
      setFlyout({ row, anchor: element })
    }
    if (flyout && flyout.anchor !== element && options.aiming) {
      pending.current = element
      timer.current = window.setTimeout(show, aimDelay)
      return
    }
    if (flyout?.anchor !== element) show()
  }
  const follow = () => {
    if (keyboard.current || !pointer.current) return
    const element = document.elementFromPoint(pointer.current.x, pointer.current.y)?.closest<HTMLElement>("[data-row]")
    const row = rows.find((each) => each.key === element?.dataset.row)
    if (!element || !row) return
    setActive(row.key)
    setFlyout({ row, anchor: element })
  }
  const leave = () => {
    window.clearTimeout(timer.current)
    pending.current = undefined
    timer.current = window.setTimeout(() => setFlyout(undefined), 150)
  }
  return (
    <PaletteDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close()
        if (open) {
          setQuery("")
          setActive(undefined)
          setStaged({})
        }
        props.onOpenChange(open)
      }}
      title="Choose model"
      search={{
        value: query,
        label: "Search models",
        onChange: (value) => {
          setQuery(value)
          setNavigated(false)
          setActive(undefined)
          close()
        },
        onKeyDown,
      }}
      className="h-[min(--spacing(120),calc(100dvh-(--spacing(24))))]"
    >
      <div
        ref={list}
        className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5"
        onScroll={follow}
        onMouseMove={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY }
        }}
        onMouseLeave={() => {
          pointer.current = undefined
          leave()
        }}
      >
        {rows.length === 0 ? <PaletteEmpty>No models found</PaletteEmpty> : null}
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-1">
            <PaletteHeading>{group.title}</PaletteHeading>
            {group.models.map((model) => {
              const row: Row = { key: modelKey(model), model, group }
              return (
                <ModelRow
                  key={`${group.key}:${row.key}`}
                  row={row}
                  query={query}
                  active={current?.key === row.key && current.group.key === group.key}
                  selected={props.picker.isCurrent(model)}
                  effort={effortOf(model)}
                  onHover={hover}
                  onPick={() => choose(row)}
                />
              )
            })}
          </div>
        ))}
      </div>
      {flyout ? (
        <Flyout
          row={flyout.row}
          anchor={flyout.anchor}
          staged={effortOf(flyout.row.model)}
          onPick={(variant) => choose(flyout.row, variant)}
          onEnter={() => window.clearTimeout(timer.current)}
          onLeave={leave}
        />
      ) : null}
    </PaletteDialog>
  )
}

export function ModelPicker(props: {
  models: ReadonlyArray<Choice>
  value: SessionModel.Ref | undefined
  loading?: boolean | undefined
  disabled?: boolean | undefined
  onChange: (model: SessionModel.Ref) => void
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const picker = usePicker(props.models, props.value, props.onChange)
  const [own, setOwn] = useState(false)
  const open = props.open ?? own
  const setOpen = (next: boolean) => {
    setOwn(next)
    props.onOpenChange?.(next)
  }
  if (props.loading)
    return (
      <Loading label="Loading models" className="ml-auto">
        <InputGroupButton disabled>
          Choose model
          <IconChevronDown />
        </InputGroupButton>
      </Loading>
    )
  if (!picker) return null
  return (
    <span className="ml-auto flex min-w-0 items-center gap-0.5">
      <ModelChip picker={picker} disabled={props.disabled} onOpen={() => setOpen(true)} />
      <EffortChip picker={picker} disabled={props.disabled} />
      <ModelDialog models={props.models} picker={picker} open={open} onOpenChange={setOpen} />
    </span>
  )
}
