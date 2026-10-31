import { useState } from "react"
import { IconChevronDown } from "@tabler/icons-react"
import type { SessionModel } from "@ren/schema/session/model"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { InputGroupButton } from "@ren/ui/input-group"
import { Skeleton } from "@ren/ui/skeleton"
import { MenuSearch } from "./menu-search.js"
import { ProviderMark } from "./provider-mark.js"
import { modelKey } from "../lib/format.js"
import { cn } from "cn"

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
  readonly effort: string
  readonly model: Choice
}

const featuredOf = (models: ReadonlyArray<Choice>): ReadonlyArray<Featured> =>
  [
    {
      label: "Recommended",
      hint: "Best balance of speed and quality",
      effort: "medium",
      model: newest(models, /gpt.*sol/iu) ?? newest(models, /sonnet/iu),
    },
    {
      label: "Smartest",
      hint: "Most capable for hard problems",
      effort: "xhigh",
      model: newest(models, /opus/iu) ?? newest(models, /gpt.*astra/iu),
    },
    {
      label: "Fastest",
      hint: "Quick answers for simple work",
      effort: "low",
      model: newest(models, /haiku/iu) ?? newest(models, /gpt.*luna/iu),
    },
  ].flatMap((each) => (each.model ? [{ ...each, model: each.model }] : []))

interface Picker {
  readonly models: ReadonlyArray<Choice>
  readonly current: Choice
  readonly variant: string | undefined
  readonly featured: ReadonlyArray<Featured>
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
  return {
    models,
    current,
    variant,
    featured,
    providers: [...new Set(models.map((model) => model.providerID))],
    isCurrent: (model) => modelKey(model) === key,
    pick: (model, next) => {
      const efforts = effortsOf(model)
      const chosen = next ?? defaultEffort(efforts, variant)
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

function defaultEffort(efforts: ReadonlyArray<string>, variant: string | undefined) {
  if (variant && efforts.includes(variant)) return variant
  if (efforts.includes("medium")) return "medium"
  return efforts[0]
}

function FeaturedModels(props: { picker: Picker; match: (model: Choice) => boolean }) {
  const featured = props.picker.featured.filter((each) => props.match(each.model))
  if (featured.length === 0) return null
  return (
    <DropdownMenuGroup>
      {featured.map((each) => (
        <DropdownMenuItem
          key={each.label}
          onClick={() =>
            props.picker.pick(each.model, effortsOf(each.model).includes(each.effort) ? each.effort : undefined)
          }
          className="items-center gap-2.5 py-2"
        >
          <ProviderIcon provider={each.model.providerID} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex h-5 min-w-0 items-center gap-1.5">
              <span className="font-medium">{each.label}</span>
              <span className="truncate text-muted-foreground">{each.model.name}</span>
            </span>
            <span className="text-xs text-muted-foreground">{each.hint}</span>
          </span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}

function ClassicLook(props: {
  picker: Picker
  disabled?: boolean | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const picker = props.picker
  const [query, setQuery] = useState("")
  const match = (model: Choice) => model.name.toLowerCase().includes(query.trim().toLowerCase())
  const row = (model: Choice) =>
    model.variants.length === 0 ? (
      // ast-grep-ignore: require-item-group -- rows render inside each provider's DropdownMenuGroup
      <DropdownMenuItem key={modelKey(model)} onClick={() => picker.pick(model)}>
        <ProviderIcon provider={model.providerID} />
        {model.name}
      </DropdownMenuItem>
    ) : (
      <DropdownMenuSub key={modelKey(model)}>
        <DropdownMenuSubTrigger>
          <ProviderIcon provider={model.providerID} />
          {model.name}
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
        <MenuSearch value={query} onChange={setQuery} placeholder="Search models…" separator={false} />
        <div className={cn(listHeight, "p-1")}>
          <FeaturedModels picker={picker} match={match} />
          {picker.providers.map((provider) => {
            const models = picker.models.filter((model) => model.providerID === provider && match(model))
            if (models.length === 0) return null
            return (
              <DropdownMenuGroup key={provider}>
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
