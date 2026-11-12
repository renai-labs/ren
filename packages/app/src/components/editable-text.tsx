import { useState } from "react"
import { IconPencil } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import { Textarea } from "@ren/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { cn } from "cn"

function TextView(props: {
  value: string
  label: string
  placeholder: string | undefined
  multiline: boolean | undefined
  className: string | undefined
  saving: boolean
  onEdit: () => void
}) {
  const text = props.multiline ? "line-clamp-3 break-words whitespace-pre-wrap" : "truncate"
  return (
    <span
      className={cn("flex min-w-0 gap-1 text-sm", props.multiline ? "items-start" : "items-center", props.className)}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              className={cn(
                "h-auto min-w-0 cursor-text justify-start p-0 text-left font-normal hover:bg-transparent",
                text,
                props.multiline && "py-1",
                !props.value && "text-muted-foreground",
              )}
              onClick={props.onEdit}
            />
          }
        >
          {props.value || props.placeholder}
        </TooltipTrigger>
        {props.value ? <TooltipContent>{props.value}</TooltipContent> : null}
      </Tooltip>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground"
        aria-label={`Edit ${props.label}`}
        onClick={props.onEdit}
      >
        {props.saving ? <Spinner /> : <IconPencil />}
      </Button>
    </span>
  )
}

export function EditableText(props: {
  value: string
  label: string
  placeholder?: string | undefined
  required?: boolean | undefined
  readOnly?: boolean | undefined
  multiline?: boolean | undefined
  className?: string | undefined
  editing?: boolean | undefined
  onEditingChange?: ((editing: boolean) => void) | undefined
  onCommit: (value: string) => Promise<unknown>
}) {
  const [draft, setDraft] = useState<string>()
  const [localEditing, setLocalEditing] = useState(false)
  const editing = props.editing ?? localEditing
  const setEditing = (next: boolean) => {
    if (!next) setDraft(undefined)
    setLocalEditing(next)
    props.onEditingChange?.(next)
  }
  const [saving, setSaving] = useState(false)
  const text = props.multiline ? "line-clamp-3 break-words whitespace-pre-wrap" : "truncate"
  if (props.readOnly)
    return (
      <span className={cn("min-w-0 text-sm", text, !props.value && "text-muted-foreground")}>
        {props.value || props.placeholder}
      </span>
    )
  if (!editing)
    return (
      <TextView
        value={props.value}
        label={props.label}
        placeholder={props.placeholder}
        multiline={props.multiline}
        className={props.className}
        saving={saving}
        onEdit={() => setEditing(true)}
      />
    )
  const commit = async () => {
    const next = (draft ?? props.value).trim()
    setEditing(false)
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
        value={draft ?? props.value}
        className={cn("max-h-48 w-3xl max-w-full", props.className)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === "Escape") setEditing(false)
        }}
      />
    )
  return (
    <Input
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field opens because the person asked to edit
      autoFocus
      aria-label={props.label}
      placeholder={props.placeholder}
      value={draft ?? props.value}
      className={cn("h-8 w-72 max-w-full", props.className)}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") setEditing(false)
      }}
    />
  )
}
