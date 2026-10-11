export * as SearchField from "./search-field.js"

import { useRef, useState } from "react"
import type { KeyboardEventHandler } from "react"
import { Icon } from "./icon.js"
import { IconButton } from "./icon-button.js"
import { TextField } from "./text-field.js"
import type { TextFieldAppearance, TextFieldSize, TextFieldWidth } from "./text-field.js"

export type RootProps = {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  label?: string
  width?: TextFieldWidth
  size?: TextFieldSize
  appearance?: TextFieldAppearance
  icon?: "visible" | "hidden"
  autoFocus?: boolean
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
}

export function Root(props: RootProps) {
  return <Field {...props} />
}

function Field(props: RootProps & { focusOnMount?: boolean; onFocus?: () => void; onDismiss?: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const placeholder = props.placeholder ?? "Search"
  return (
    <TextField
      ref={input}
      type="search"
      size={props.size ?? "small"}
      appearance={props.appearance ?? "filled"}
      width={props.width ?? "full"}
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
      leading={props.icon === "hidden" ? undefined : <Icon glyph="Search" />}
      trailing={
        props.value ? (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              props.onValueChange("")
              input.current?.focus()
            }}
            className="grid size-4 place-items-center rounded-full text-text-secondary hover:text-text-primary"
          >
            <Icon glyph="X" size="extra-small" />
          </button>
        ) : null
      }
    />
  )
}

export function Expandable(props: RootProps) {
  const [state, setState] = useState<"collapsed" | "expanded" | "dismissed">("collapsed")
  const size = props.size ?? "small"
  if (state !== "expanded" && props.value.length === 0) {
    return (
      <IconButton
        label={props.label ?? props.placeholder ?? "Search"}
        size={size === "compact" ? "small" : size}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Escape removed the focused field, so focus returns to the button that replaced it
        autoFocus={state === "dismissed"}
        onClick={() => setState("expanded")}
      >
        <Icon glyph="Search" />
      </IconButton>
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
