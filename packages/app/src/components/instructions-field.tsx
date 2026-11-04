import { useState } from "react"
import { Streamdown } from "streamdown"
import { IconPencil } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Textarea } from "@ren/ui/textarea"

export function InstructionsField(props: {
  label: string
  value: string
  placeholder: string
  readOnly: boolean
  disabled?: boolean | undefined
  onChange: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  if (editing || (!props.value && !props.readOnly))
    return (
      <Textarea
        aria-label={props.label}
        value={props.value}
        readOnly={props.readOnly}
        disabled={props.disabled}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the editor opens because the person asked to edit
        autoFocus={editing}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur()
        }}
        placeholder={props.placeholder}
        className="min-h-80 rounded-xl bg-card p-4 font-mono text-sm dark:bg-card"
      />
    )
  return (
    <div className="group/instructions relative min-h-24 rounded-xl border bg-card p-4">
      {props.readOnly ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2 text-muted-foreground opacity-0 transition-opacity duration-150 ease-out group-hover/instructions:opacity-100 focus-visible:opacity-100"
          onClick={() => setEditing(true)}
        >
          <IconPencil />
          Edit
        </Button>
      )}
      <Streamdown controls={false} className="min-w-0 text-sm/relaxed [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm">
        {props.value || "No instructions yet."}
      </Streamdown>
    </div>
  )
}
