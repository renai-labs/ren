import { useState } from "react"
import type { InferencePluginField, ProviderInfo, RenInferenceSignIn } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { IconExternalLink } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { Textarea } from "@ren/ui/textarea"
import { toast } from "@ren/ui/sonner"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"

export type Method = "subscription" | "key"

function FieldInput(props: {
  field: InferencePluginField
  value: string
  invalid: boolean
  disabled: boolean
  onChange: (value: string) => void
}) {
  const field = props.field
  const id = `provider-field-${field.name}`
  const shared = {
    id,
    value: props.value,
    placeholder: field.placeholder,
    autoComplete: "off",
    disabled: props.disabled,
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
      {props.invalid ? <FieldError>{field.label} is required.</FieldError> : null}
    </Field>
  )
}

function KeyForm(props: { provider: ProviderInfo; onConnected: () => void; onCancel: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const [values, setValues] = useState<Readonly<Record<string, string>>>({})
  const [missing, setMissing] = useState<ReadonlyArray<string>>([])
  const [failure, setFailure] = useState<string>()
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
  return (
    <form
      className="contents"
      aria-label={`Add a ${provider.name} key`}
      onSubmit={(event) => {
        event.preventDefault()
        if (!filled()) return
        save.mutate(input(), {
          onSuccess: () => {
            toast.success(`${provider.name} key saved`)
            props.onConnected()
          },
          onError: (error) => setFailure(errorMessage(error)),
        })
      }}
    >
      <FieldGroup>
        <p className="text-sm text-muted-foreground">
          {provider.name} bills your organization per token. Ren checks the key with {provider.name}, passes it on once
          and keeps only its last 4 characters.
        </p>
        {provider.fields.map((field) => (
          <FieldInput
            key={field.name}
            field={field}
            value={values[field.name] ?? ""}
            invalid={missing.includes(field.name)}
            disabled={save.isPending}
            onChange={(value) => {
              setValues((previous) => ({ ...previous, [field.name]: value }))
              setMissing((previous) => previous.filter((name) => name !== field.name))
              setFailure(undefined)
            }}
          />
        ))}
        {failure ? <FieldError>{failure}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          {save.isPending ? "Checking the key…" : "Save key"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// oxlint-disable-next-line ren/no-comments -- Step 1: ask the inference service for the vendor's sign-in address and open it in a new tab.
function SignInStep(props: {
  provider: ProviderInfo
  started: boolean
  onStarted: (signIn: RenInferenceSignIn) => void
  onFailed: (message: string) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const start = useMutation(api["ren-inference"].signIn.start.mutationOptions())
  const provider = props.provider
  return (
    <Field>
      <FieldLabel>1. Sign in</FieldLabel>
      <div>
        <Button
          type="button"
          variant={props.started ? "outline" : "default"}
          disabled={start.isPending}
          onClick={() =>
            start.mutate(
              { provider: provider.id },
              {
                onSuccess: (started) => {
                  props.onStarted(started)
                  platform.openExternal(started.url)
                },
                onError: (failed) => props.onFailed(errorMessage(failed)),
              },
            )
          }
        >
          {start.isPending ? <Spinner data-icon="inline-start" /> : <IconExternalLink data-icon="inline-start" />}
          {props.started ? "Open the sign-in again" : (provider.signIn ?? `Sign in to ${provider.name}`)}
        </Button>
      </div>
      <FieldDescription>Opens in a new tab.</FieldDescription>
    </Field>
  )
}

// oxlint-disable-next-line ren/no-comments -- Providers §5.1: open the vendor's sign-in in a new tab, then paste back what it shows. The inference service says what that is, so the app names no vendor.
function SubscriptionForm(props: { provider: ProviderInfo; onConnected: () => void; onCancel: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const complete = useMutation(api["ren-inference"].signIn.complete.mutationOptions())
  const [signIn, setSignIn] = useState<RenInferenceSignIn>()
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const provider = props.provider
  return (
    <form
      className="contents"
      aria-label={`Connect a ${provider.name} subscription`}
      onSubmit={(event) => {
        event.preventDefault()
        if (!signIn) return
        if (!code.trim()) return setError("Paste what the sign-in showed.")
        complete.mutate(
          { id: signIn.id, provider: provider.id, code: code.trim() },
          {
            onSuccess: () => {
              toast.success(`${provider.name} subscription connected`)
              props.onConnected()
            },
            onError: (failed) => setError(errorMessage(failed)),
          },
        )
      }}
    >
      <FieldGroup>
        <p className="text-sm text-muted-foreground">
          Each member signs in with their own {provider.name} plan. Chats use the plan’s limits, with no per-token bill.
        </p>
        <SignInStep
          provider={provider}
          started={signIn !== undefined}
          onStarted={(started) => {
            setSignIn(started)
            setError(undefined)
          }}
          onFailed={setError}
        />
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="provider-sign-in-code">2. Paste it here</FieldLabel>
          <Input
            id="provider-sign-in-code"
            value={code}
            autoComplete="off"
            disabled={!signIn || complete.isPending}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setCode(event.currentTarget.value)
              setError(undefined)
            }}
          />
          <FieldDescription>{signIn?.paste ?? "After you sign in, paste what the sign-in shows."}</FieldDescription>
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!signIn || complete.isPending}>
          {complete.isPending ? <Spinner data-icon="inline-start" /> : null}
          Connect subscription
        </Button>
      </DialogFooter>
    </form>
  )
}

// oxlint-disable-next-line ren/no-comments -- Connect a provider by a subscription or a key. Any member connects their own subscription; only admins add a key. With `choose`, an admin's first connection also becomes what chats use.
export function ConnectDialog(props: {
  provider: ProviderInfo
  method?: Method
  choose?: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const update = useMutation(api.provider.update.mutationOptions())
  const provider = props.provider
  const offered = [
    ...(provider.methods.includes("subscription") ? (["subscription"] as const) : []),
    ...(provider.canManage && provider.fields.length > 0 ? (["key"] as const) : []),
  ]
  const [method, setMethod] = useState<Method>(
    props.method && offered.includes(props.method) ? props.method : (offered.at(0) ?? "key"),
  )
  const connected = () => {
    if (props.choose && provider.canManage && provider.methods.length > 1 && provider.method !== method)
      update.mutate({ id: provider.id, method })
    props.onConnected()
  }
  const cancel = () => props.onOpenChange(false)
  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {provider.name}</DialogTitle>
          <DialogDescription>
            {offered.length > 1 ? "Choose how chats reach its models." : "Connect it to use its models in chats."}
          </DialogDescription>
        </DialogHeader>
        {offered.length > 1 ? (
          <Tabs value={method} onValueChange={(value) => setMethod(value === "key" ? "key" : "subscription")}>
            <TabsList aria-label="Connect by" className="w-full">
              <TabsTrigger value="subscription">Subscription</TabsTrigger>
              <TabsTrigger value="key">API key</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        {method === "subscription" ? (
          <SubscriptionForm provider={provider} onConnected={connected} onCancel={cancel} />
        ) : (
          <KeyForm provider={provider} onConnected={connected} onCancel={cancel} />
        )}
      </DialogContent>
    </Dialog>
  )
}
