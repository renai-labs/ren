export * as Select from "./select.js"

import { Select } from "@base-ui/react/select"
import { cva } from "class-variance-authority"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { controlOutline, controlSize, optionRow, popupSurface, revealOnContainerHover } from "../lib/control-chrome.js"
import { Icon } from "./icon.js"

export type Size = "small" | "compact" | "medium" | "large"
export type Appearance = "outline" | "filled" | "plain" | "inline" | "property" | "chip"
export type Shape = "rounded" | "pill" | "square" | "circle" | "fit"
export type Indicator = "chevron" | "chevron-up" | "none"
export type Width = "content" | "compact" | "limited" | "fill" | "full"

export type Option<Value extends string = string> = {
  value: Value
  label: ReactNode
  icon?: ReactNode
}

const triggerVariants = cva(
  "flex min-w-0 items-center justify-between gap-2 text-text-primary transition-standard outline-none disabled:pointer-events-none disabled:opacity-disabled [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      appearance: {
        outline: `${controlOutline} hover:bg-fill-primary focus-visible:inset-ring-accent-primary data-invalid:inset-ring-status-danger data-popup-open:bg-fill-primary`,
        filled:
          "rounded-control bg-fill-primary hover:bg-fill-secondary focus-visible:inset-ring-1 focus-visible:inset-ring-accent-primary data-popup-open:bg-fill-secondary",
        plain:
          "rounded-control bg-transparent text-text-secondary hover:bg-fill-primary hover:text-text-primary data-popup-open:bg-fill-primary",
        inline:
          "rounded-control bg-transparent px-1 text-text-secondary hover:text-text-primary active:scale-98 data-popup-open:text-text-primary [&>svg:last-child]:opacity-disabled",
        chip: "rounded-control bg-fill-primary font-medium inset-ring-1 inset-ring-border-primary hover:bg-fill-secondary data-popup-open:bg-fill-secondary [&_svg]:size-3.5",
        property:
          "max-w-full rounded-control bg-transparent font-medium text-text-primary hover:bg-fill-secondary disabled:opacity-100 data-invalid:text-status-danger data-popup-open:bg-fill-secondary",
      },
      size: controlSize,
      shape: {
        rounded: "",
        pill: "rounded-full",
        square: "",
        circle: "justify-center rounded-full",
        fit: "h-auto max-w-full rounded-full px-0 hover:bg-transparent data-popup-open:bg-transparent",
      },
      width: { content: "", compact: "w-36", limited: "max-w-72", fill: "min-w-0 flex-1", full: "w-full" },
      visibility: { always: "", "on-container-hover": revealOnContainerHover },
    },
    defaultVariants: {
      appearance: "outline",
      size: "medium",
      shape: "rounded",
      width: "content",
      visibility: "always",
    },
    compoundVariants: [
      { shape: "pill", size: "small", className: "px-3" },
      { appearance: "property", shape: "pill", size: "small", className: "pr-3 pl-2 text-sm" },
      { appearance: "chip", shape: "pill", size: "small", className: "gap-2 px-3" },
      { shape: ["square", "circle"], size: "small", className: "size-6 px-0" },
      { shape: ["square", "circle"], size: "medium", className: "size-8 px-0" },
      { appearance: "inline", className: "px-1" },
    ],
  },
)

type Chrome = {
  size?: Size
  appearance?: Appearance
  shape?: Shape
  indicator?: Indicator
  width?: Width
  leading?: ReactNode
  placeholder?: ReactNode
}

export type RootProps<Value extends string> = Chrome & {
  value?: Value | null
  defaultValue?: Value | null
  onValueChange?: (value: Value) => void
  defaultOpen?: boolean
  options: readonly Option<Value>[]
  disabled?: boolean
  label?: string
  id?: string
  name?: string
  // ast-grep-ignore: no-render-props, -- hands the selected option back to the caller
  renderValue?: (option: Option<Value> | undefined) => ReactNode
}

export function Root<Value extends string>(props: RootProps<Value>) {
  return (
    <Select.Root<Value>
      value={props.value}
      defaultValue={props.defaultValue}
      onValueChange={(next) => {
        if (next !== null) props.onValueChange?.(next)
      }}
      defaultOpen={props.defaultOpen}
      disabled={props.disabled}
      name={props.name}
    >
      <Select.Trigger
        id={props.id}
        data-slot="select"
        aria-label={props.label}
        className={composeClasses(
          triggerVariants({
            appearance: props.appearance,
            size: props.size,
            shape: props.shape,
            width: props.width,
          }),
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {props.leading ? (
            <span className="flex shrink-0 items-center text-text-secondary">{props.leading}</span>
          ) : null}
          <Select.Value className="flex min-w-0 items-center gap-2 truncate" placeholder={props.placeholder}>
            {(current: Value | null) => {
              const option = props.options.find((candidate) => candidate.value === current)
              if (props.renderValue) return props.renderValue(option)
              return <SelectedValue option={option} placeholder={props.placeholder} />
            }}
          </Select.Value>
        </span>
        <Chevron indicator={props.indicator ?? "chevron"} />
      </Select.Trigger>
      <Popup options={props.options} />
    </Select.Root>
  )
}

function SelectedValue<Value extends string>(props: { option: Option<Value> | undefined; placeholder: ReactNode }) {
  if (!props.option) return props.placeholder
  return (
    <>
      {props.option.icon}
      <span className="truncate">{props.option.label}</span>
    </>
  )
}

function Chevron(props: { indicator: Indicator }) {
  if (props.indicator === "none") return null
  return (
    <Select.Icon
      render={<Icon glyph={props.indicator === "chevron-up" ? "ChevronUp" : "ChevronDown"} tone="secondary" />}
    />
  )
}

function Popup<Value extends string>(props: { options: readonly Option<Value>[] }) {
  return (
    <Select.Portal>
      <Select.Positioner
        data-ren-layer=""
        sideOffset={4}
        align="start"
        alignItemWithTrigger={false}
        className="z-50 flex max-h-80 flex-col"
      >
        <Select.Popup
          className={composeClasses(
            popupSurface,
            "max-h-(--available-height) min-h-0 min-w-(--anchor-width) overflow-y-auto overscroll-contain p-1",
          )}
        >
          <Select.Group className="flex flex-col">
            {props.options.map((option) => (
              <Select.Item key={option.value} value={option.value} className={composeClasses(optionRow, "pr-8")}>
                {option.icon}
                <span className="flex min-w-0 flex-col">
                  <Select.ItemText className="truncate">{option.label}</Select.ItemText>
                </span>
                <Select.ItemIndicator className="absolute right-2 flex items-center">
                  <Icon glyph="Check" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Group>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  )
}

export type ButtonProps = Chrome &
  Omit<ComponentPropsWithRef<"button">, "className" | "style"> & {
    label: string
    invalid?: boolean
    visibility?: "always" | "on-container-hover"
  }

export function Button(props: ButtonProps) {
  const {
    size,
    appearance,
    shape,
    indicator,
    width,
    label,
    placeholder,
    leading,
    invalid,
    visibility,
    children,
    ...rest
  } = props
  const empty = !children
  return (
    <button
      type="button"
      data-slot="select"
      aria-label={label}
      data-invalid={invalid === true ? "" : undefined}
      data-placeholder={empty ? "" : undefined}
      className={composeClasses(triggerVariants({ appearance, size, shape, width, visibility }))}
      {...rest}
    >
      <span className="flex min-w-0 items-center gap-2">
        {leading ? <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">{leading}</span> : null}
        <span
          data-placeholder={empty ? "" : undefined}
          className="flex min-w-0 items-center gap-2 truncate data-placeholder:text-text-secondary"
        >
          <TextLabel>{children ?? placeholder}</TextLabel>
        </span>
      </span>
      {indicator === "none" ? null : (
        <Icon glyph={indicator === "chevron-up" ? "ChevronUp" : "ChevronDown"} tone="secondary" />
      )}
    </button>
  )
}

function TextLabel(props: { children: ReactNode }) {
  const plain = [props.children].flat().every((child) => typeof child !== "object" || child === null)
  if (plain) return <span className="truncate">{props.children}</span>
  return props.children
}
