import type { StandardSchemaV1 } from "@tanstack/react-form"
import { useId, useState } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Button } from "./button.js"
import { Icon } from "./icon.js"
import { Input } from "./input.js"
import { Text } from "./text.js"

export function InlineEdit(props: {
  value: string
  onCommit: (next: string) => unknown
  label: string
  placeholder?: string
  alignment?: "start" | "end"
  required?: boolean
  schema?: StandardSchemaV1<string>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refocus, setRefocus] = useState(false)
  const placeholder = props.placeholder ?? "Empty"
  const finish = () => {
    setDraft(null)
    setError(null)
  }
  const commit = async () => {
    if (draft === null || saving) return
    const next = draft.trim()
    if ((props.required === true && !next) || next === props.value) return finish()
    setSaving(true)
    setError(null)
    const result = await props.schema?.["~standard"].validate(next)
    const problem = result?.issues?.at(0)?.message
    if (problem) {
      setSaving(false)
      return setError(problem)
    }
    const saved = await Promise.resolve()
      .then(() => props.onCommit(next))
      .then(
        () => true,
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Couldn’t save.")
          return false
        },
      )
    setSaving(false)
    if (saved) setDraft(null)
  }
  if (draft === null) {
    return (
      <Display
        value={props.value}
        label={props.label}
        placeholder={placeholder}
        alignment={props.alignment ?? "start"}
        refocus={refocus}
        onEdit={() => setDraft(props.value)}
      />
    )
  }
  return (
    <Editor
      draft={draft}
      label={props.label}
      placeholder={placeholder}
      saving={saving}
      error={error}
      onDraftChange={(next) => {
        setDraft(next)
        setError(null)
      }}
      onBlur={() => {
        setRefocus(false)
        void commit()
      }}
      onKey={(key) => {
        setRefocus(true)
        if (key === "Escape") return finish()
        void commit()
      }}
    />
  )
}

function Editor(props: {
  draft: string
  label: string
  placeholder: string
  saving: boolean
  error: string | null
  onDraftChange: (draft: string) => void
  onBlur: () => void
  onKey: (key: "Enter" | "Escape") => void
}) {
  const errorId = useId()
  return (
    <span className="flex w-full min-w-0 flex-col gap-1">
      <Input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field replaces the Edit button the user just pressed
        autoFocus
        value={props.draft}
        disabled={props.saving}
        placeholder={props.placeholder}
        aria-label={props.label}
        aria-invalid={props.error !== null || undefined}
        aria-describedby={props.error === null ? undefined : errorId}
        onChange={(event) => props.onDraftChange(event.target.value)}
        onBlur={props.onBlur}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== "Escape") return
          event.preventDefault()
          props.onKey(event.key)
        }}
      />
      {props.error === null ? null : (
        <Text purpose="caption" tone="danger" id={errorId}>
          {props.error}
        </Text>
      )}
    </span>
  )
}

function Display(props: {
  value: string
  label: string
  placeholder: string
  alignment: "start" | "end"
  refocus: boolean
  onEdit: () => void
}) {
  return (
    <span
      className={composeClasses(
        "flex min-w-0 flex-col gap-1",
        props.alignment === "end" ? "-mr-2 items-end" : "w-full",
      )}
    >
      <Button
        variant="ghost"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Enter or Escape removed the focused field, so focus returns to the button that replaced it
        autoFocus={props.refocus}
        aria-label={`Edit ${props.label}`}
        onClick={props.onEdit}
        className={composeClasses(
          "h-auto max-w-full min-w-0 gap-2 px-2 py-1 text-start font-normal",
          props.alignment === "end" ? "justify-end" : "-ml-2 justify-start",
          props.value ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="min-w-0 truncate">{props.value || props.placeholder}</span>
        <span className="flex shrink-0 text-muted-foreground transition-colors group-hover/button:text-foreground">
          <Icon glyph="Pencil" size="extra-small" />
        </span>
      </Button>
    </span>
  )
}
