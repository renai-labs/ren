import { useState } from "react"
import type { InferencePluginField, ProviderTestResult } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { IconCircleCheck } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import { Textarea } from "@ren/ui/textarea"
import { toast } from "@ren/ui/sonner"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"

export interface Connecting {
  readonly id: string
  readonly name: string
  readonly fields: ReadonlyArray<InferencePluginField>
}

function FieldInput(props: {
  field: InferencePluginField
  value: string
  invalid: boolean
  onChange: (value: string) => void
}) {
  const field = props.field
  const id = `provider-field-${field.name}`
  const shared = {
    id,
    value: props.value,
    placeholder: field.placeholder,
    autoComplete: "off",
    "aria-invalid": props.invalid || undefined,
  }
  return (
    <Field data-invalid={props.invalid || undefined}>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      {field.multiline ? (
        <Textarea {...shared} rows={5} onChange={(event) => props.onChange(event.currentTarget.value)} />
      ) : (
        <Input
          {...shared}
          type={field.secret ? "password" : "text"}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      )}
      {props.invalid ? <FieldError>Enter {field.label.toLowerCase()}.</FieldError> : null}
    </Field>
  )
}

export function ConnectDialog(props: {
  provider: Connecting
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const [values, setValues] = useState<Readonly<Record<string, string>>>({})
  const [missing, setMissing] = useState<ReadonlyArray<string>>([])
  const [tested, setTested] = useState<ProviderTestResult>()
  const test = useMutation(api.provider.test.mutationOptions())
  const save = useMutation(api.provider.key.save.mutationOptions())
  const provider = props.provider
  const filled = () => {
    const empty = provider.fields.filter((field) => !values[field.name]?.trim()).map((field) => field.name)
    setMissing(empty)
    return empty.length === 0
  }
  const input = () => ({
    id: provider.id,
    fields: Object.fromEntries(provider.fields.map((field) => [field.name, values[field.name]?.trim() ?? ""])),
  })
  const failure = tested && !tested.ok ? (tested.message ?? "The provider refused these details.") : undefined
  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {provider.name}</DialogTitle>
          <DialogDescription>
            Ren passes these on to the provider once and keeps only the last 4 characters.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          aria-label={`Connect ${provider.name}`}
          onSubmit={(event) => {
            event.preventDefault()
            if (!filled()) return
            save.mutate(input(), {
              onSuccess: () => {
                toast.success(`${provider.name} connected`)
                props.onConnected()
              },
              onError: (error) => setTested({ ok: false, message: errorMessage(error) }),
            })
          }}
        >
          <FieldGroup>
            {provider.fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={values[field.name] ?? ""}
                invalid={missing.includes(field.name)}
                onChange={(value) => {
                  setValues((previous) => ({ ...previous, [field.name]: value }))
                  setMissing((previous) => previous.filter((name) => name !== field.name))
                  setTested(undefined)
                }}
              />
            ))}
            {failure ? <FieldError>{failure}</FieldError> : null}
            {tested?.ok ? (
              <output className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <IconCircleCheck className="size-4" />
                Connection works
              </output>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending}
              onClick={() => {
                if (!filled()) return
                test.mutate(input(), {
                  onSuccess: setTested,
                  onError: (error) => setTested({ ok: false, message: errorMessage(error) }),
                })
              }}
            >
              {test.isPending ? <Spinner data-icon="inline-start" /> : null}
              Test connection
            </Button>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
