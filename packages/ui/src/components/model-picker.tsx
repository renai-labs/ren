import type { ReactNode } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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

export type ModelPickerProps = {
  models: readonly Model[]
  value: Selection | undefined
  onValueChange: (value: Selection) => void
  disabled?: boolean
  loading?: boolean
  fallback?: string
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}

const defaultVariant = "default"

const select = (model: Model, variant: string): Selection =>
  variant === defaultVariant ? { model: model.value } : { model: model.value, variant }

function triggerLabel(name: string | undefined, effort: string | undefined) {
  if (!name) return "Model"
  if (!effort) return `Model: ${name}`
  return `Model: ${name}, reasoning effort: ${effort}`
}

const describe = (props: ModelPickerProps, selected: Model | undefined) => {
  if (props.loading) return { name: "Loading…", effort: undefined }
  if (!selected?.variants.length) return { name: selected?.label ?? props.fallback, effort: undefined }
  const variant = selected.variants.find((each) => each.value === props.value?.variant)
  return { name: selected.label, effort: variant?.label ?? "Default" }
}

export function ModelPicker(props: ModelPickerProps) {
  const selected = props.models.find((model) => model.value === props.value?.model)
  const shown = describe(props, selected)
  const name = shown.name
  const effort = shown.effort
  const groups = [...Map.groupBy(props.models, (model) => model.group)]
  return (
    <DropdownMenu open={props.open} onOpenChange={(open) => props.onOpenChange?.(open)}>
      <DropdownMenuTrigger
        disabled={props.disabled === true || props.loading === true || props.models.length === 0}
        aria-label={triggerLabel(name, effort)}
        render={<InputGroupButton size="sm" className="max-w-72 min-w-0 pr-1.5 font-normal text-muted-foreground" />}
      >
        <TriggerContent icon={props.loading ? undefined : selected?.icon} name={name} effort={effort} />
        <Icon glyph="ChevronDown" data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        {groups.map(([group, models]) => (
          <DropdownMenuGroup key={group}>
            <DropdownMenuLabel className="flex items-center gap-2">
              {models.at(0)?.icon}
              {group}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={selected?.group === group ? selected.value : ""}
              onValueChange={(value) => {
                const model = props.models.find((item) => item.value === value)
                if (model) props.onValueChange(select(model, defaultVariant))
              }}
            >
              {models.map((model) => (
                <Choice
                  key={model.value}
                  model={model}
                  selected={model === selected}
                  variant={props.value?.variant}
                  effort={model === selected ? effort : undefined}
                  onValueChange={props.onValueChange}
                />
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  effort: string | undefined
  onValueChange: (value: Selection) => void
}) {
  if (props.model.variants.length === 0)
    return (
      <DropdownMenuRadioItem value={props.model.value} closeOnClick>
        {props.model.label}
      </DropdownMenuRadioItem>
    )
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={props.selected ? "font-medium" : undefined}>
        <span className="min-w-0 flex-1 truncate">{props.model.label}</span>
        {props.selected ? (
          <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground">
            {props.effort}
            <Icon glyph="Check" tone="primary" />
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={props.selected ? (props.variant ?? defaultVariant) : ""}
            onValueChange={(variant) => {
              if (typeof variant === "string") props.onValueChange(select(props.model, variant))
            }}
          >
            <DropdownMenuRadioItem value={defaultVariant} closeOnClick>
              Default
            </DropdownMenuRadioItem>
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
