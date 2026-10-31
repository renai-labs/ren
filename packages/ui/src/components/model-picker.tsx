import { useState, type ReactNode } from "react"
import { IconSearch } from "@tabler/icons-react"
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
} from "./dropdown-menu.js"
import { Icon } from "./icon.js"
import { InputGroupButton } from "./input-group.js"
import { Text } from "./text.js"

export type Variant = { value: string; label: string }

export type Model = { value: string; label: string; group: string; icon?: ReactNode; variants: readonly Variant[] }

export type Selection = { model: string; variant?: string }

export type Featured = { label: string; hint: string; model: string; variant?: string }

export type ModelPickerProps = {
  models: readonly Model[]
  featured?: readonly Featured[]
  value: Selection | undefined
  onValueChange: (value: Selection) => void
  disabled?: boolean
  loading?: boolean
  fallback?: string
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}

function triggerLabel(name: string | undefined, effort: string | undefined) {
  if (!name) return "Model"
  if (!effort) return `Model: ${name}`
  return `Model: ${name}, reasoning effort: ${effort}`
}

const describe = (props: ModelPickerProps, selected: Model | undefined) => {
  if (props.loading) return { name: "Loading…", effort: undefined }
  if (!selected?.variants.length) return { name: selected?.label ?? props.fallback, effort: undefined }
  const variant = selected.variants.find((each) => each.value === props.value?.variant)
  return { name: selected.label, effort: variant?.label }
}

export function ModelPicker(props: ModelPickerProps) {
  const selected = props.models.find((model) => model.value === props.value?.model)
  const shown = describe(props, selected)
  const name = shown.name
  const effort = shown.effort
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const matches = (model: Model) => model.label.toLowerCase().includes(needle)
  const groups = [...Map.groupBy(props.models.filter(matches), (model) => model.group)]
  const byValue = new Map(props.models.filter(matches).map((model) => [model.value, model]))
  return (
    <DropdownMenu
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setQuery("")
        props.onOpenChange?.(open)
      }}
    >
      <DropdownMenuTrigger
        disabled={props.disabled === true || props.loading === true || props.models.length === 0}
        aria-label={triggerLabel(name, effort)}
        render={<InputGroupButton size="sm" className="max-w-72 min-w-0 pr-1.5 font-normal text-muted-foreground" />}
      >
        <TriggerContent icon={props.loading ? undefined : selected?.icon} name={name} effort={effort} />
        <Icon glyph="ChevronDown" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-80 p-0">
        <label className="flex h-10 items-center gap-2 px-3 text-muted-foreground">
          <IconSearch className="size-4 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key.length === 1 || event.key === "Backspace") event.stopPropagation()
            }}
            placeholder="Search models…"
            aria-label="Search models"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground caret-foreground outline-none placeholder:text-muted-foreground focus-visible:placeholder:text-muted-foreground/60"
          />
        </label>
        <div className="h-80 overflow-y-auto overscroll-contain p-1">
          {props.featured?.length ? (
            <DropdownMenuGroup>
              {props.featured.map((each) => {
                const model = byValue.get(each.model)
                return model ? (
                  <FeaturedRow key={each.label} featured={each} model={model} onValueChange={props.onValueChange} />
                ) : null
              })}
            </DropdownMenuGroup>
          ) : null}
          {groups.map(([group, models]) => (
            <DropdownMenuGroup key={group}>
              <DropdownMenuLabel>{group}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={selected?.group === group ? selected.value : ""}
                onValueChange={(value) => {
                  const model = props.models.find((item) => item.value === value)
                  if (model) props.onValueChange({ model: model.value })
                }}
              >
                {models.map((model) => (
                  <Choice
                    key={model.value}
                    model={model}
                    selected={model === selected}
                    variant={props.value?.variant}
                    onValueChange={props.onValueChange}
                  />
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          ))}
          {groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No models match</p>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FeaturedRow(props: { featured: Featured; model: Model; onValueChange: (value: Selection) => void }) {
  return (
    <DropdownMenuItem
      className="items-center gap-2.5 py-2"
      onClick={() =>
        props.onValueChange({
          model: props.model.value,
          ...(props.featured.variant && { variant: props.featured.variant }),
        })
      }
    >
      {props.model.icon}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex h-5 min-w-0 items-center gap-1.5">
          <span className="font-medium">{props.featured.label}</span>
          <span className="truncate text-muted-foreground">{props.model.label}</span>
        </span>
        <span className="text-xs text-muted-foreground">{props.featured.hint}</span>
      </span>
    </DropdownMenuItem>
  )
}

function TriggerContent(props: { icon: ReactNode; name: string | undefined; effort: string | undefined }) {
  return (
    <>
      {props.icon}
      {props.name ? (
        <Text purpose="body" tone="inherit" truncation="single-line" element="span">
          {props.name}
        </Text>
      ) : null}
      {props.effort ? (
        <>
          <Text purpose="body" tone="secondary" element="span">
            ·
          </Text>
          <Text purpose="body" tone="inherit" truncation="single-line" element="span">
            {props.effort}
          </Text>
        </>
      ) : null}
    </>
  )
}

function Choice(props: {
  model: Model
  selected: boolean
  variant: string | undefined
  onValueChange: (value: Selection) => void
}) {
  if (props.model.variants.length === 0)
    return (
      <DropdownMenuRadioItem value={props.model.value} closeOnClick>
        {props.model.icon}
        {props.model.label}
      </DropdownMenuRadioItem>
    )
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {props.model.icon}
        <span className="min-w-0 flex-1 truncate">{props.model.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={props.selected ? (props.variant ?? "") : ""}
            onValueChange={(variant) => {
              if (typeof variant === "string") props.onValueChange({ model: props.model.value, variant })
            }}
          >
            {props.model.variants.map((variant) => (
              <DropdownMenuRadioItem key={variant.value} value={variant.value} closeOnClick>
                {variant.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
