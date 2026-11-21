import { useState } from "react"
import type { RenInferenceCreatedKey } from "@ren/client"
import { RenInference } from "@ren/schema/ren-inference"
import { useMutation } from "@tanstack/react-query"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Schema } from "effect"
import { Copyable } from "../../components/copyable.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"

const expiries: ReadonlyArray<{ value: RenInference.Expiry; label: string }> = [
  { value: "never", label: "Never" },
  { value: "7d", label: "In 7 days" },
  { value: "30d", label: "In 30 days" },
  { value: "1y", label: "In 1 year" },
]

const isExpiry = Schema.is(RenInference.Expiry)

function CopyStep(props: { created: RenInferenceCreatedKey; onDone: () => void }) {
  return (
    <>
      <Alert>
        <AlertDescription>Ren shows this key only once. Store it somewhere safe before you close.</AlertDescription>
      </Alert>
      <FieldGroup>
        <Copyable id="created-key" label="Key" value={props.created.secret} />
        <Copyable id="created-base-url" label="Base URL" value={props.created.baseUrl} />
      </FieldGroup>
      <DialogFooter>
        <Button onClick={props.onDone}>Done</Button>
      </DialogFooter>
    </>
  )
}

function ExpirySelect(props: { value: RenInference.Expiry; onChange: (value: RenInference.Expiry) => void }) {
  return (
    <Field>
      <FieldLabel>Expires</FieldLabel>
      <Select
        items={expiries}
        value={props.value}
        onValueChange={(value) => {
          if (isExpiry(value)) props.onChange(value)
        }}
      >
        <SelectTrigger aria-label="Expires" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {expiries.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription>After it expires, calls with the key fail. You can revoke it at any time.</FieldDescription>
    </Field>
  )
}

function CreateStep(props: {
  pending: boolean
  error: string | undefined
  onCancel: () => void
  onSubmit: (input: RenInference.CreateKeyInput) => void
}) {
  const [name, setName] = useState("")
  const [expiresIn, setExpiresIn] = useState<RenInference.Expiry>("never")
  const [invalid, setInvalid] = useState(false)
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) props.onSubmit({ name: name.trim(), expiresIn })
        else setInvalid(true)
      }}
    >
      <FieldGroup>
        <Field data-invalid={invalid || undefined}>
          <FieldLabel htmlFor="key-name">Name</FieldLabel>
          <Input
            id="key-name"
            maxLength={64}
            placeholder="Work laptop"
            aria-invalid={invalid || undefined}
            value={name}
            onChange={(event) => {
              setName(event.currentTarget.value)
              setInvalid(false)
            }}
          />
          {invalid ? <FieldError>Enter a name.</FieldError> : null}
        </Field>
        <ExpirySelect value={expiresIn} onChange={setExpiresIn} />
        {props.error ? <FieldError>{props.error}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={props.pending}>
          {props.pending ? <Spinner data-icon="inline-start" /> : null}
          Create key
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CreateKeyDialog(props: { onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const create = useMutation(api["ren-inference"].key.create.mutationOptions())
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{create.data ? "Copy your key" : "Create inference key"}</DialogTitle>
          <DialogDescription>
            {create.data
              ? "Use the key and the base URL in Claude Code, Codex or your script."
              : "Call Ren’s models from Claude Code, Codex, scripts and other tools."}
          </DialogDescription>
        </DialogHeader>
        {create.data ? (
          <CopyStep created={create.data} onDone={props.onClose} />
        ) : (
          <CreateStep
            pending={create.isPending}
            error={create.error ? errorMessage(create.error) : undefined}
            onCancel={props.onClose}
            onSubmit={(input) => create.mutate(input)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
