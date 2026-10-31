import { useState } from "react"
import { IconPencil } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import { cn } from "cn"

export function EditableText(props: {
  value: string
  label: string
  placeholder?: string | undefined
  required?: boolean | undefined
  readOnly?: boolean | undefined
  className?: string | undefined
  onCommit: (value: string) => Promise<unknown>
}) {
  const [draft, setDraft] = useState<string>()
  const [saving, setSaving] = useState(false)
  if (props.readOnly)
    return (
      <span className={cn("text-sm", !props.value && "text-muted-foreground")}>{props.value || props.placeholder}</span>
    )
  if (draft === undefined)
    return (
      <span className={cn("flex min-w-0 items-center gap-1 text-sm", props.className)}>
        <span className={cn("truncate", !props.value && "text-muted-foreground")}>
          {props.value || props.placeholder}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label={`Edit ${props.label}`}
          onClick={() => setDraft(props.value)}
        >
          {saving ? <Spinner /> : <IconPencil />}
        </Button>
      </span>
    )
  const commit = async () => {
    const next = draft.trim()
    setDraft(undefined)
    if (next === props.value || (props.required && !next)) return
    setSaving(true)
    try {
      await props.onCommit(next)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Input
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field opens because the person asked to edit
      autoFocus
      aria-label={props.label}
      placeholder={props.placeholder}
      value={draft}
      className={cn("h-8 w-72 max-w-full", props.className)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") setDraft(undefined)
      }}
    />
  )
}
