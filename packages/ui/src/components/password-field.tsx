import { useState } from "react"
import { flushSync } from "react-dom"
import { Icon } from "./icon.js"
import { IconButton } from "./icon-button.js"
import { TextField } from "./text-field.js"
import type { TextFieldProps } from "./text-field.js"

export type PasswordFieldProps = Omit<TextFieldProps, "type" | "trailing" | "suggestions" | "onSuggestionSelect">

export function PasswordField(props: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false)
  return (
    <TextField
      {...props}
      type={revealed ? "text" : "password"}
      trailing={
        <IconButton
          label={revealed ? "Hide password" : "Show password"}
          appearance="plain"
          size="compact"
          aria-pressed={revealed}
          disabled={props.disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            const input = event.currentTarget.closest('[data-slot="text-field"]')?.querySelector("input")
            const selection = { start: input?.selectionStart ?? null, end: input?.selectionEnd ?? null }
            flushSync(() => setRevealed((value) => !value))
            if (input === undefined || input === null || input !== document.activeElement) return
            void input.offsetWidth
            input.setSelectionRange(selection.start, selection.end)
          }}
        >
          <Icon glyph={revealed ? "EyeOff" : "Eye"} />
        </IconButton>
      }
    />
  )
}
