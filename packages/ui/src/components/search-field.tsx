export * as SearchField from "./search-field.js"

import { cva } from "class-variance-authority"
import { useRef, useState } from "react"
import type { KeyboardEventHandler } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Button } from "./button.js"
import { Icon } from "./icon.js"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group.js"

export type Size = "small" | "compact" | "medium" | "large"
export type Appearance = "outline" | "filled"
export type Width = "full" | "fill" | "compact"

export type RootProps = {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  label?: string
  width?: Width
  size?: Size
  appearance?: Appearance
  icon?: "visible" | "hidden"
  autoFocus?: boolean
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
}

const groupVariants = cva("", {
  variants: {
    appearance: {
      outline: "",
      filled:
        "border-0 bg-muted inset-ring inset-ring-transparent transition-colors hover:bg-secondary has-[[data-slot=input-group-control]:focus-visible]:inset-ring-ring dark:bg-muted",
    },
    size: { small: "h-7", compact: "h-7", medium: "h-8", large: "h-10" },
    width: { full: "w-full", fill: "min-w-0 flex-1", compact: "w-52" },
  },
})

const iconSizes = { small: "icon-sm", compact: "icon-sm", medium: "icon", large: "icon" } as const

export function Root(props: RootProps) {
  return <Field {...props} />
}

function Field(props: RootProps & { focusOnMount?: boolean; onFocus?: () => void; onDismiss?: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const placeholder = props.placeholder ?? "Search"
  const appearance = props.appearance ?? "filled"
  return (
    <InputGroup
      data-slot="search-field"
      className={composeClasses(
        groupVariants({ appearance, size: props.size ?? "small", width: props.width ?? "full" }),
      )}
    >
      {props.icon === "hidden" ? null : (
        <InputGroupAddon className={appearance === "filled" ? "pl-3" : undefined}>
          <Icon glyph="Search" />
        </InputGroupAddon>
      )}
      <InputGroupInput
        ref={input}
        type="search"
        value={props.value}
        placeholder={placeholder}
        aria-label={props.label ?? placeholder}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- callers opt in, and Expandable focuses the field it just revealed
        autoFocus={props.autoFocus === true || props.focusOnMount === true}
        onChange={(event) => props.onValueChange(event.target.value)}
        onFocus={props.onFocus}
        onBlur={() => props.onDismiss?.()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            props.onValueChange("")
            props.onDismiss?.()
          }
          props.onKeyDown?.(event)
        }}
        className={composeClasses(
          "h-full [&::-webkit-search-cancel-button]:appearance-none",
          appearance === "filled" && props.icon !== "hidden" && "pl-1",
        )}
      />
      {props.value ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-sm"
            aria-label="Clear search"
            className="rounded-full text-muted-foreground"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              props.onValueChange("")
              input.current?.focus()
            }}
          >
            <Icon glyph="X" size="extra-small" />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}

export function Expandable(props: RootProps) {
  const [state, setState] = useState<"collapsed" | "expanded" | "dismissed">("collapsed")
  if (state !== "expanded" && props.value.length === 0) {
    return (
      <Button
        variant="ghost"
        size={iconSizes[props.size ?? "small"]}
        aria-label={props.label ?? props.placeholder ?? "Search"}
        className="text-muted-foreground"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Escape removed the focused field, so focus returns to the button that replaced it
        autoFocus={state === "dismissed"}
        onClick={() => setState("expanded")}
      >
        <Icon glyph="Search" />
      </Button>
    )
  }
  return (
    <Field
      {...props}
      width={props.width ?? "compact"}
      focusOnMount={state === "expanded"}
      onKeyDown={(event) => {
        if (event.key === "Escape") setState("dismissed")
        props.onKeyDown?.(event)
      }}
      onFocus={() => setState("expanded")}
      onDismiss={() => setState((current) => (current === "dismissed" ? current : "collapsed"))}
    />
  )
}
