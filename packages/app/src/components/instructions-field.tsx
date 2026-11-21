import { useState } from "react"
import { Streamdown } from "streamdown"
import { IconPencil } from "@tabler/icons-react"
import { cn } from "cn"
import { Button } from "@ren/ui/button"
import { Textarea } from "@ren/ui/textarea"

export function InstructionsField(props: {
  label: string
  value: string
  placeholder: string
  empty?: string | undefined
  readOnly: boolean
  saving: boolean
  onSave: (value: string) => Promise<unknown>
}) {
  const [draft, setDraft] = useState<string>()
  const save = (value: string) =>
    void props.onSave(value).then(
      () => setDraft(undefined),
      () => setDraft(value),
    )
  if (draft !== undefined)
    return (
      <div className="flex flex-col gap-2">
        <Textarea
          aria-label={props.label}
          value={draft}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the editor opens because the person asked to edit
          autoFocus
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft !== props.value) save(draft)
            if (event.key === "Escape" && draft === props.value) setDraft(undefined)
          }}
          placeholder={props.placeholder}
          className="min-h-80 rounded-xl bg-card p-4 font-mono text-sm dark:bg-card"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={props.saving} onClick={() => setDraft(undefined)}>
            Cancel
          </Button>
          <Button size="sm" disabled={props.saving || draft === props.value} onClick={() => save(draft)}>
            {props.saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    )
  return (
    <div className="group/instructions relative min-h-24 rounded-xl border bg-card p-4">
      {props.readOnly ? null : (
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "absolute top-2 right-2 text-muted-foreground",
            props.value &&
              "opacity-0 transition-opacity duration-150 ease-out group-hover/instructions:opacity-100 focus-visible:opacity-100",
          )}
          onClick={() => setDraft(props.value)}
        >
          <IconPencil />
          Edit
        </Button>
      )}
      <Streamdown controls={false} className="min-w-0 text-sm/relaxed [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm">
        {props.value || (props.empty ?? "No instructions yet.")}
      </Streamdown>
    </div>
  )
}
