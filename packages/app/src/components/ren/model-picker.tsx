import { useState, type ReactNode } from "react"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import type { SessionModel } from "@ren/schema/session/model"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroupButton } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { MenuSearch } from "@/components/ren/menu-search"
import { ProviderMark } from "@/components/ren/provider-mark"
import { modelKey } from "@/lib/format"
import { cn } from "@/lib/utils"

type Choice = SessionModel.Choice

const providerName: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
}

export function pickModel(
  models: ReadonlyArray<Choice>,
  picks: ReadonlyArray<SessionModel.Ref | null | undefined>,
): SessionModel.Ref | undefined {
  const found = picks.find((pick) => pick && models.some((model) => modelKey(model) === modelKey(pick)))
  if (found) return found
  const first = models.at(0)
  if (!first) return undefined
  const variant = first.variants.find((each) => each.id === "medium")?.id ?? first.variants.at(0)?.id
  return { id: first.id, providerID: first.providerID, ...(variant && { variant }) }
}

function ProviderIcon(props: { provider: string }) {
  return <ProviderMark provider={providerName[props.provider] ?? props.provider} />
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

const effortOrder = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]

const effortRank = (id: string) => {
  const index = effortOrder.indexOf(id)
  return index === -1 ? effortOrder.length : index
}

const effortLabel = (id: string) => (id === "xhigh" ? "Extra high" : capitalize(id))

const effortsOf = (model: Choice) =>
  model.variants.map((each) => each.id).toSorted((a, b) => effortRank(a) - effortRank(b))

const versionOf = (name: string) => Number.parseFloat(/(\d+(?:\.\d+)?)/u.exec(name)?.[1] ?? "0")

const newest = (models: ReadonlyArray<Choice>, pattern: RegExp) =>
  models
    .filter((model) => pattern.test(model.name))
    .reduce<Choice | undefined>(
      (best, model) => (!best || versionOf(model.name) > versionOf(best.name) ? model : best),
      undefined,
    )

interface Featured {
  readonly label: string
  readonly hint: string
  readonly model: Choice
}

const featuredOf = (models: ReadonlyArray<Choice>): ReadonlyArray<Featured> =>
  [
    {
      label: "Recommended",
      hint: "Best balance of speed and quality",
      model: newest(models, /sonnet/iu) ?? newest(models, /gpt.*sol/iu),
    },
    {
      label: "Smartest",
      hint: "Most capable for hard problems",
      model: newest(models, /opus/iu) ?? newest(models, /gpt.*astra/iu),
    },
    {
      label: "Fastest",
      hint: "Quick answers for simple work",
      model: newest(models, /haiku/iu) ?? newest(models, /gpt.*luna/iu),
    },
  ].flatMap((each) => (each.model ? [{ ...each, model: each.model }] : []))

interface Picker {
  readonly models: ReadonlyArray<Choice>
  readonly current: Choice
  readonly variant: string | undefined
  readonly featured: ReadonlyArray<Featured>
  readonly rest: ReadonlyArray<Choice>
  readonly providers: ReadonlyArray<string>
  readonly isCurrent: (model: Choice) => boolean
  readonly pick: (model: Choice, variant?: string) => void
}

const usePicker = (
  models: ReadonlyArray<Choice>,
  value: SessionModel.Ref | undefined,
  onChange: (model: SessionModel.Ref) => void,
): Picker | undefined => {
  const key = value ? modelKey(value) : undefined
  const current = models.find((model) => modelKey(model) === key)
  if (!current) return undefined
  const variant = value?.variant ?? current.variants.at(0)?.id
  const featured = featuredOf(models)
  const featuredKeys = new Set(featured.map((each) => modelKey(each.model)))
  return {
    models,
    current,
    variant,
    featured,
    rest: models.filter((model) => !featuredKeys.has(modelKey(model))),
    providers: [...new Set(models.map((model) => model.providerID))],
    isCurrent: (model) => modelKey(model) === key,
    pick: (model, next) => {
      const efforts = effortsOf(model)
      const chosen =
        next ?? (variant && efforts.includes(variant) ? variant : efforts.includes("medium") ? "medium" : efforts[0])
      onChange({ id: model.id, providerID: model.providerID, ...(chosen && { variant: chosen }) })
    },
  }
}

function TriggerLabel(props: { picker: Picker; effort?: boolean | undefined }) {
  return (
    <>
      <ProviderIcon provider={props.picker.current.providerID} />
      {props.picker.current.name}
      {props.effort !== false && props.picker.variant ? (
        <>
          <span aria-hidden>·</span>
          {effortLabel(props.picker.variant)}
        </>
      ) : null}
      <IconChevronDown />
    </>
  )
}

const triggerClass = "ml-auto pr-1.5 font-normal text-muted-foreground"

const listHeight = "h-80 overflow-y-auto overscroll-contain scrollbar-thin"

function ClassicLook(props: {
  picker: Picker
  disabled?: boolean | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const picker = props.picker
  const [query, setQuery] = useState("")
  const match = (model: Choice) => model.name.toLowerCase().includes(query.trim().toLowerCase())
  const row = (model: Choice, content?: ReactNode) =>
    model.variants.length === 0 ? (
      <DropdownMenuItem
        key={modelKey(model)}
        onClick={() => picker.pick(model)}
        className={content ? "items-start py-2" : undefined}
      >
        <ProviderIcon provider={model.providerID} />
        {content ?? model.name}
        {picker.isCurrent(model) ? <IconCheck className="ml-auto" /> : null}
      </DropdownMenuItem>
    ) : (
      <DropdownMenuSub key={modelKey(model)}>
        <DropdownMenuSubTrigger className={content ? "items-start py-2" : undefined}>
          <ProviderIcon provider={model.providerID} />
          {content ?? model.name}
          {picker.isCurrent(model) ? (
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              {effortLabel(picker.variant ?? "")}
              <IconCheck className="text-foreground" />
            </span>
          ) : null}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={picker.isCurrent(model) ? (picker.variant ?? "") : ""}
            onValueChange={(value: string) => picker.pick(model, value)}
          >
            {effortsOf(model).map((effort) => (
              <DropdownMenuRadioItem key={effort} value={effort} closeOnClick>
                {effortLabel(effort)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  return (
    <DropdownMenu
      {...(props.open !== undefined && { open: props.open })}
      {...(props.onOpenChange && { onOpenChange: props.onOpenChange })}
    >
      <DropdownMenuTrigger disabled={props.disabled} render={<InputGroupButton size="sm" className={triggerClass} />}>
        <TriggerLabel picker={picker} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-80 p-0">
        <MenuSearch value={query} onChange={setQuery} placeholder="Search models…" />
        <div className={cn(listHeight, "p-1")}>
          {picker.featured.some((each) => match(each.model)) ? (
            <DropdownMenuGroup>
              {picker.featured
                .filter((each) => match(each.model))
                .map((each) =>
                  row(
                    each.model,
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="font-medium">{each.label}</span>
                        <span className="truncate text-muted-foreground">{each.model.name}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{each.hint}</span>
                    </span>,
                  ),
                )}
            </DropdownMenuGroup>
          ) : null}
          {picker.providers.map((provider) => {
            const models = picker.rest.filter((model) => model.providerID === provider && match(model))
            if (models.length === 0) return null
            return (
              <DropdownMenuGroup key={provider}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{providerName[provider] ?? provider}</DropdownMenuLabel>
                {models.map((model) => row(model))}
              </DropdownMenuGroup>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
  if (props.loading) return <Skeleton className="ml-auto h-7 w-44 rounded-md" />
  if (!picker) return null
  const shared = { picker, disabled: props.disabled, open: props.open, onOpenChange: props.onOpenChange }
  return <ClassicLook {...shared} />
}
