import type { CredentialOwner, CredentialRequirementItem } from "@ren/client"
import { Credential } from "@ren/schema/credential"
import { Primitive } from "@ren/schema/primitive"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Dialog } from "@ren/ui/dialog"
import { Form } from "@ren/ui/form"
import { List } from "@ren/ui/list"
import { Notice } from "@ren/ui/notice"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Schema } from "effect"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { PasteCredentialDialog } from "../../components/paste-credential-dialog.js"

const AnotherForm = Schema.toStandardSchemaV1(
  Schema.Struct({
    connection: Credential.Connection,
    connectionName: Primitive.Name,
  }),
)

const statusBadge = {
  ok: { label: "Connected", tone: "success" },
  missing: { label: "Not connected", tone: "neutral" },
  reconnect: { label: "Reconnect", tone: "danger" },
} as const

interface RowProps {
  item: CredentialRequirementItem
  pending: boolean
  onConnect: () => void
  onAnother: () => void
  onPaste: () => void
}

function RequirementRow(props: RowProps) {
  const badge = statusBadge[props.item.status]
  return (
    <List.Item
      title={props.item.name}
      description={props.item.label}
      trailing={
        <span className="flex items-center gap-2">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <ItemAction {...props} />
        </span>
      }
    />
  )
}

// oxlint-disable-next-line ren/no-comments -- connections.md §10a: one item per MCP and env key of the app, then its dependencies grouped by app. Each click runs one sign-in in a new tab; the list asks again when the window gets focus, so it never polls.
export function ConnectAppDialog(props: {
  spaceId: string
  appId: string
  appNames: ReadonlyMap<string, string>
  spaceName: string
  personal: boolean
  userId: string
  onClose: () => void
}) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const platform = Platform.usePlatform()
  const input = { spaceId: props.spaceId, appId: props.appId }
  const requirements = useQuery({
    ...context.api["credential-connect"].credential.requirements.queryOptions(input),
    refetchOnWindowFocus: "always",
  })
  const connect = useMutation(context.api["credential-connect"].credential.connect.mutationOptions())
  const [another, setAnother] = useState<CredentialRequirementItem>()
  const [pasting, setPasting] = useState<CredentialRequirementItem>()
  const owner: CredentialOwner = props.personal
    ? { kind: "person", userId: props.userId }
    : { kind: "space", spaceId: props.spaceId }
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: context.api["credential-connect"].credential.requirements.queryKey() }),
      queryClient.invalidateQueries({ queryKey: context.api.credential.list.queryKey() }),
    ])
  const start = (item: CredentialRequirementItem, extra: { connection?: string; connectionName?: string } = {}) =>
    connect
      .mutateAsync({
        owner,
        target: { kind: "mcp", app: item.app, mcp: item.mcp ?? "", ...extra },
        ...(item.status === "reconnect" && !extra.connection && { reconnect: true }),
      })
      .then(async (result) => {
        if ("redirectUrl" in result) platform.openExternal(result.redirectUrl)
        else await refresh()
      })
      .catch(() => undefined)
  const items = requirements.data?.items ?? []
  const groups = [...new Set(items.map((item) => item.group))]
  return (
    <>
      <Dialog.Root
        open
        onOpenChange={(open) => {
          if (!open) props.onClose()
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Connect {props.appNames.get(props.appId) ?? "app"}</Dialog.Title>
            <Dialog.Description>
              {props.personal
                ? "Each sign-in reaches your own account, for your chats in this space."
                : `Everyone in ${props.spaceName} can use these accounts.`}
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            {groups.map((group) => (
              <List.Root key={group} label={props.appNames.get(group) ?? "App"}>
                <List.Section title={props.appNames.get(group) ?? "App"} appearance="eyebrow">
                  {items
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <RequirementRow
                        key={item.key}
                        item={item}
                        pending={connect.isPending}
                        onConnect={() => void start(item)}
                        onAnother={() => setAnother(item)}
                        onPaste={() => setPasting(item)}
                      />
                    ))}
                </List.Section>
              </List.Root>
            ))}
            <Notice tone="danger" placement="inline">
              {(connect.error ?? requirements.error)?.message}
            </Notice>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
      {another ? (
        <AnotherAccountDialog
          item={another}
          pending={connect.isPending}
          onClose={() => setAnother(undefined)}
          onSubmit={async (value) => {
            await start(another, value)
            setAnother(undefined)
          }}
        />
      ) : null}
      {pasting ? (
        <PasteCredentialDialog
          title={`Add ${pasting.label}`}
          description={`The ${props.appNames.get(pasting.app) ?? ""} app reads this key.`}
          owners={[
            props.personal
              ? { value: `person:${props.userId}`, label: "Only me" }
              : { value: `space:${props.spaceId}`, label: props.spaceName },
          ]}
          userId={props.userId}
          defaults={{ label: pasting.label }}
          labelFixed
          submitLabel="Save key"
          onClose={() => setPasting(undefined)}
          onSaved={refresh}
        />
      ) : null}
    </>
  )
}

function ItemAction(props: RowProps) {
  if (props.item.kind === "env" || props.item.kind === "fields")
    return props.item.status === "ok" ? null : (
      <Button appearance="secondary" size="small" onClick={props.onPaste}>
        Add key
      </Button>
    )
  if (props.item.status === "ok")
    return (
      <Button appearance="secondary" size="small" disabled={props.pending} onClick={props.onAnother}>
        Add another account
      </Button>
    )
  return (
    <Button appearance="primary" size="small" disabled={props.pending} onClick={props.onConnect}>
      {props.item.status === "reconnect" ? "Reconnect" : "Connect"}
    </Button>
  )
}

function AnotherAccountDialog(props: {
  item: CredentialRequirementItem
  pending: boolean
  onClose: () => void
  onSubmit: (value: { connection: string; connectionName: string }) => Promise<void>
}) {
  const form = Form.useForm({
    defaultValues: { connection: "", connectionName: "" },
    schema: AnotherForm,
    onSubmit: (value) => props.onSubmit(value),
  })
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={props.pending ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Add another {props.item.name} account</Dialog.Title>
          <Dialog.Description>
            The agent tells accounts apart by their display name. Its server is {props.item.mcp}__
            {"<connection>"}.
          </Dialog.Description>
        </Dialog.Header>
        <Form.Root form={form} arrangement="contents">
          <Dialog.Body>
            <form.AppField name="connectionName">
              {(field) => <field.TextField label="Display name" placeholder="Acme client" />}
            </form.AppField>
            <form.AppField name="connection">
              {(field) => <field.TextField label="Connection" placeholder="acme" />}
            </form.AppField>
          </Dialog.Body>
          <Dialog.Footer>
            <form.SubmitButton pendingLabel="Opening sign-in…">Sign in</form.SubmitButton>
          </Dialog.Footer>
        </Form.Root>
      </Dialog.Content>
    </Dialog.Root>
  )
}
