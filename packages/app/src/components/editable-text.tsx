import { useState } from "react"
import { IconPencil } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import { Textarea } from "@ren/ui/textarea"
import { cn } from "cn"

export function EditableText(props: {
  value: string
  label: string
  placeholder?: string | undefined
  required?: boolean | undefined
  readOnly?: boolean | undefined
  multiline?: boolean | undefined
  className?: string | undefined
  onCommit: (value: string) => Promise<unknown>
}) {
  const [draft, setDraft] = useState<string>()
  const [saving, setSaving] = useState(false)
  const text = props.multiline ? "line-clamp-3 break-words whitespace-pre-wrap" : "truncate"
  if (props.readOnly)
    return (
      <span className={cn("min-w-0 text-sm", text, !props.value && "text-muted-foreground")}>
        {props.value || props.placeholder}
      </span>
    )
  if (draft === undefined)
    return (
      <span
        className={cn("flex min-w-0 gap-1 text-sm", props.multiline ? "items-start" : "items-center", props.className)}
      >
        <span className={cn(text, props.multiline && "py-1", !props.value && "text-muted-foreground")}>
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
  if (props.multiline)
    return (
      <Textarea
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field opens because the person asked to edit
        autoFocus
        aria-label={props.label}
        placeholder={props.placeholder}
        value={draft}
        className={cn("max-h-48 w-3xl max-w-full", props.className)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === "Escape") setDraft(undefined)
        }}
      />
    )
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
