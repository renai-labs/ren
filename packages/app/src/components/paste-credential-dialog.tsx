import type { CredentialInfo } from "@ren/client"
import { Dialog } from "@ren/ui/dialog"
import { Form } from "@ren/ui/form"
import { Notice } from "@ren/ui/notice"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { useMutation } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { RouterContext } from "../lib/router-context.js"
import { Credentials } from "./credentials.js"

export function PasteCredentialDialog(props: {
  title: string
  description: ReactNode
  owners: ReadonlyArray<{ readonly value: string; readonly label: string; readonly glyph: Glyph }>
  userId: string
  defaults?: { readonly label?: string; readonly owner?: string }
  labelFixed?: boolean
  warning?: ReactNode
  submitLabel: string
  onClose: () => void
  onSaved: (credential: CredentialInfo) => Promise<unknown>
}) {
  const context = RouterContext.useRouterContext()
  const create = useMutation(context.api.credential.create.mutationOptions())
  const form = Form.useForm({
    defaultValues: {
      label: props.defaults?.label ?? "",
      anyHost: false as boolean,
      hosts: "",
      value: "",
      owner: props.defaults?.owner ?? props.owners.at(0)?.value ?? "org",
    },
    schema: Credentials.PasteForm,
    onSubmit: async (value) => {
      const saved = await create
        .mutateAsync({
          payload: {
            owner: Credentials.ownerOf(value.owner, props.userId),
            label: value.label,
            hosts: Credentials.hostsOf(value),
            value: { type: "key", value: value.value },
          },
        })
        .catch(() => undefined)
      if (!saved) return
      await props.onSaved(saved)
      props.onClose()
    },
  })
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={create.isPending ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>{props.title}</Dialog.Title>
          <Dialog.Description>{props.description}</Dialog.Description>
        </Dialog.Header>
        <Form.Root form={form} arrangement="contents">
          <Dialog.Body>
            {props.warning ? (
              <Notice tone="warning" placement="inline">
                {props.warning}
              </Notice>
            ) : null}
            <form.AppField name="label">
              {(field) => (
                <field.TextField
                  label="Env name"
                  description="Chats see it as an env var that holds ren:<name>. It cannot change later."
                  placeholder="STRIPE_API_KEY"
                  disabled={props.labelFixed}
                />
              )}
            </form.AppField>
            <form.AppField name="value">
              {(field) => <field.PasswordField label="Key" placeholder="sk_live_…" autoComplete="off" />}
            </form.AppField>
            <form.AppField name="anyHost">{(field) => <field.Switch label="Use on any website" />}</form.AppField>
            <form.Subscribe selector={(state) => state.values.anyHost}>
              {(anyHost) =>
                anyHost ? null : (
                  <form.AppField name="hosts">
                    {(field) => (
                      <field.TextField
                        label="Websites"
                        description="Ren adds the key only to requests to these hosts."
                        placeholder="api.stripe.com"
                      />
                    )}
                  </form.AppField>
                )
              }
            </form.Subscribe>
            {props.owners.length > 1 ? (
              <form.AppField name="owner">
                {(field) => (
                  <field.Select
                    label="Who can use it"
                    options={props.owners.map((owner) => ({
                      value: owner.value,
                      label: owner.label,
                      icon: <Icon glyph={owner.glyph} />,
                    }))}
                  />
                )}
              </form.AppField>
            ) : null}
            <Notice tone="danger" placement="inline">
              {create.error?.message}
            </Notice>
          </Dialog.Body>
          <Dialog.Footer>
            <form.SubmitButton pendingLabel="Saving…">{props.submitLabel}</form.SubmitButton>
          </Dialog.Footer>
        </Form.Root>
      </Dialog.Content>
    </Dialog.Root>
  )
}
