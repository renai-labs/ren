import { useState, type ReactNode } from "react"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import type { SessionModel } from "@ren/schema/session/model"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
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
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MenuSearch } from "@/components/ren/menu-search"
import { ProviderMark } from "@/components/ren/provider-mark"
import { modelKey } from "@/lib/format"
import { cn } from "@/lib/utils"
import { chooseModelPickerLook, useModelPickerLook, type ModelPickerLook } from "@/stores/ui"

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

const effortHints: Readonly<Record<string, string>> = {
  none: "Answers right away",
  minimal: "Quickest replies",
  low: "Fast, light thinking",
  medium: "Balanced speed and care",
  high: "Thinks more carefully",
  xhigh: "Very thorough",
  max: "Most thorough, slowest",
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

function EffortSegments(props: { picker: Picker }) {
  const efforts = effortsOf(props.picker.current)
  if (efforts.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5 border-t p-2">
      <span className="px-1 text-xs text-muted-foreground">Effort</span>
      <ToggleGroup
        value={props.picker.variant ? [props.picker.variant] : []}
        onValueChange={(value: string[]) => {
          const next = value.at(0)
          if (next) props.picker.pick(props.picker.current, next)
        }}
        variant="outline"
        size="sm"
        className="w-full"
      >
        {efforts.map((effort) => (
          <ToggleGroupItem key={effort} value={effort} className="flex-1 text-xs">
            {effortLabel(effort)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
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
      <DropdownMenuItem key={modelKey(model)} onClick={() => picker.pick(model)}>
        <ProviderIcon provider={model.providerID} />
        {model.name}
        {picker.isCurrent(model) ? <IconCheck className="ml-auto" /> : null}
      </DropdownMenuItem>
    ) : (
      <DropdownMenuSub key={modelKey(model)}>
        <DropdownMenuSubTrigger>
          <ProviderIcon provider={model.providerID} />
          {model.name}
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
      <DropdownMenuContent side="top" align="start" className="w-72 p-0">
        <MenuSearch value={query} onChange={setQuery} placeholder="Search models…" />
        <div className={cn(listHeight, "p-1")}>
          {picker.featured.some((each) => match(each.model)) ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Top models</DropdownMenuLabel>
              {picker.featured.filter((each) => match(each.model)).map((each) => row(each.model))}
            </DropdownMenuGroup>
          ) : null}
          {picker.providers.map((provider) => {
            const models = picker.rest.filter((model) => model.providerID === provider && match(model))
            if (models.length === 0) return null
            return (
              <DropdownMenuGroup key={provider}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{providerName[provider] ?? provider}</DropdownMenuLabel>
                {models.map(row)}
              </DropdownMenuGroup>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GumloopLook(props: {
  picker: Picker
  disabled?: boolean | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const picker = props.picker
  return (
    <DropdownMenu
      {...(props.open !== undefined && { open: props.open })}
      {...(props.onOpenChange && { onOpenChange: props.onOpenChange })}
    >
      <DropdownMenuTrigger disabled={props.disabled} render={<InputGroupButton size="sm" className={triggerClass} />}>
        <TriggerLabel picker={picker} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-80 p-0">
        <div className={cn(listHeight, "p-1")}>
          {picker.featured.map((each) => (
            <DropdownMenuItem
              key={each.label}
              onClick={() => picker.pick(each.model)}
              className="items-start py-2"
              closeOnClick={false}
            >
              <ProviderIcon provider={each.model.providerID} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">{each.label}</span>
                  <span className="truncate text-muted-foreground">{each.model.name}</span>
                </span>
                <span className="text-xs text-muted-foreground">{each.hint}</span>
              </span>
              {picker.isCurrent(each.model) ? <IconCheck className="mt-0.5" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {picker.providers.map((provider) => (
            <DropdownMenuSub key={provider}>
              <DropdownMenuSubTrigger>
                <ProviderIcon provider={provider} />
                {providerName[provider] ?? provider}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                {picker.models
                  .filter((model) => model.providerID === provider)
                  .map((model) => (
                    <DropdownMenuItem key={modelKey(model)} onClick={() => picker.pick(model)} closeOnClick={false}>
                      {model.name}
                      {picker.isCurrent(model) ? <IconCheck className="ml-auto" /> : null}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </div>
        <EffortSegments picker={picker} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PlaneLook(props: {
  picker: Picker
  disabled?: boolean | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const picker = props.picker
  const efforts = effortsOf(picker.current)
  const item = (model: Choice) => (
    <DropdownMenuItem key={modelKey(model)} onClick={() => picker.pick(model)}>
      <ProviderIcon provider={model.providerID} />
      {model.name}
      {picker.isCurrent(model) ? <IconCheck className="ml-auto" /> : null}
    </DropdownMenuItem>
  )
  return (
    <span className="ml-auto flex items-center">
      <DropdownMenu
        {...(props.open !== undefined && { open: props.open })}
        {...(props.onOpenChange && { onOpenChange: props.onOpenChange })}
      >
        <DropdownMenuTrigger
          disabled={props.disabled}
          render={<InputGroupButton size="sm" className="pr-1.5 font-normal text-muted-foreground" />}
        >
          <TriggerLabel picker={picker} effort={false} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64 p-0">
          <div className={cn(listHeight, "p-1")}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Select a model</DropdownMenuLabel>
              {picker.featured.map((each) => item(each.model))}
            </DropdownMenuGroup>
            {picker.providers.map((provider) => {
              const models = picker.rest.filter((model) => model.providerID === provider)
              if (models.length === 0) return null
              return (
                <DropdownMenuGroup key={provider}>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{`More from ${providerName[provider] ?? provider}`}</DropdownMenuLabel>
                  {models.map(item)}
                </DropdownMenuGroup>
              )
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {efforts.length > 0 && picker.variant ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={props.disabled}
            render={<InputGroupButton size="sm" className="pr-1.5 font-normal text-muted-foreground" />}
          >
            {effortLabel(picker.variant)}
            <IconChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-56">
            <DropdownMenuRadioGroup
              value={picker.variant}
              onValueChange={(value: string) => picker.pick(picker.current, value)}
            >
              <DropdownMenuLabel>Effort</DropdownMenuLabel>
              {efforts.map((effort) => (
                <DropdownMenuRadioItem key={effort} value={effort} closeOnClick className="items-start">
                  <span className="flex flex-col">
                    {effortLabel(effort)}
                    <span className="text-xs text-muted-foreground">{effortHints[effort] ?? ""}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </span>
  )
}

function SplitLook(props: {
  picker: Picker
  disabled?: boolean | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const picker = props.picker
  const [focused, setFocused] = useState<Choice>()
  const shown = focused ?? picker.current
  const efforts = effortsOf(shown)
  const featured = picker.featured.find((each) => modelKey(each.model) === modelKey(shown))
  const row = (model: Choice) => (
    <CommandItem
      key={modelKey(model)}
      value={`${model.name} ${model.providerID}`}
      onSelect={() => {
        setFocused(model)
        picker.pick(model)
      }}
      onMouseEnter={() => setFocused(model)}
    >
      <ProviderIcon provider={model.providerID} />
      {model.name}
      {picker.isCurrent(model) ? <IconCheck className="ml-auto" /> : null}
    </CommandItem>
  )
  return (
    <Popover
      {...(props.open !== undefined && { open: props.open })}
      {...(props.onOpenChange && { onOpenChange: props.onOpenChange })}
    >
      <PopoverTrigger disabled={props.disabled} render={<InputGroupButton size="sm" className={triggerClass} />}>
        <TriggerLabel picker={picker} />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="flex w-136 flex-row gap-0 p-0">
        <Command className="w-60 shrink-0 rounded-none! border-r">
          <CommandInput placeholder="Search models…" />
          <CommandList className={cn(listHeight, "max-h-none")}>
            <CommandEmpty>No models found</CommandEmpty>
            <CommandGroup heading="Top models">{picker.featured.map((each) => row(each.model))}</CommandGroup>
            {picker.providers.map((provider) => (
              <CommandGroup key={provider} heading={providerName[provider] ?? provider}>
                {picker.rest.filter((model) => model.providerID === provider).map(row)}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-sm font-medium">
              <ProviderIcon provider={shown.providerID} />
              {shown.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {featured ? `${featured.label} · ${featured.hint}` : (providerName[shown.providerID] ?? shown.providerID)}
            </span>
          </div>
          {efforts.length > 0 ? (
            <RadioGroup
              value={picker.isCurrent(shown) ? (picker.variant ?? "") : ""}
              onValueChange={(value: unknown) => {
                if (typeof value === "string") picker.pick(shown, value)
              }}
              className="gap-2.5"
            >
              <span className="text-xs text-muted-foreground">Effort</span>
              {efforts.map((effort) => (
                <Label key={effort} className="flex items-start gap-2.5 font-normal">
                  <RadioGroupItem value={effort} className="mt-0.5" />
                  <span className="flex flex-col">
                    {effortLabel(effort)}
                    <span className="text-xs text-muted-foreground">{effortHints[effort] ?? ""}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          ) : (
            <span className="text-xs text-muted-foreground">This model has no effort settings.</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function CursorLook(props: {
  picker: Picker
  disabled?: boolean | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const picker = props.picker
  const row = (model: Choice): ReactNode => {
    const selected = picker.isCurrent(model)
    const efforts = effortsOf(model)
    return (
      <CommandItem
        key={modelKey(model)}
        value={`${model.name} ${model.providerID}`}
        onSelect={() => picker.pick(model)}
        className="h-8"
      >
        <span className={cn("flex size-4 items-center justify-center", !selected && "invisible")}>
          <IconCheck />
        </span>
        {model.name}
        {selected && efforts.length > 0 && picker.variant ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`Effort: ${effortLabel(picker.variant)}`}
                  onClick={(event) => event.stopPropagation()}
                  className="ml-auto flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                />
              }
            >
              {effortLabel(picker.variant)}
              <IconChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuRadioGroup
                value={picker.variant}
                onValueChange={(value: string) => picker.pick(model, value)}
              >
                {efforts.map((effort) => (
                  <DropdownMenuRadioItem key={effort} value={effort} closeOnClick>
                    {effortLabel(effort)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </CommandItem>
    )
  }
  return (
    <Popover
      {...(props.open !== undefined && { open: props.open })}
      {...(props.onOpenChange && { onOpenChange: props.onOpenChange })}
    >
      <PopoverTrigger disabled={props.disabled} render={<InputGroupButton size="sm" className={triggerClass} />}>
        <TriggerLabel picker={picker} />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList className={cn(listHeight, "max-h-none")}>
            <CommandEmpty>No models found</CommandEmpty>
            <CommandGroup heading="Top models">{picker.featured.map((each) => row(each.model))}</CommandGroup>
            <CommandGroup heading="All models">{picker.rest.map(row)}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
  const look = useModelPickerLook()
  const picker = usePicker(props.models, props.value, props.onChange)
  if (props.loading) return <Skeleton className="ml-auto h-7 w-44 rounded-md" />
  if (!picker) return null
  const shared = { picker, disabled: props.disabled, open: props.open, onOpenChange: props.onOpenChange }
  if (look === "gumloop") return <GumloopLook {...shared} />
  if (look === "plane") return <PlaneLook {...shared} />
  if (look === "split") return <SplitLook {...shared} />
  if (look === "cursor") return <CursorLook {...shared} />
  return <ClassicLook {...shared} />
}

const looks: ReadonlyArray<{ value: ModelPickerLook; label: string }> = [
  { value: "classic", label: "Classic" },
  { value: "gumloop", label: "Gumloop" },
  { value: "plane", label: "Plane" },
  { value: "split", label: "Split" },
  { value: "cursor", label: "Cursor" },
]

const isLook = (value: unknown): value is ModelPickerLook => looks.some((look) => look.value === value)

export function ModelPickerSwitcher() {
  const look = useModelPickerLook()
  return (
    <Tabs
      value={look}
      onValueChange={(value) => {
        if (isLook(value)) chooseModelPickerLook(value)
      }}
      className="fixed top-2.5 left-1/2 z-50 -translate-x-1/2 max-md:hidden"
    >
      <TabsList className="shadow-overlay">
        <span className="px-2 text-xs">Model picker</span>
        {looks.map((item) => (
          <TabsTrigger key={item.value} value={item.value} className="px-2.5 text-xs">
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
