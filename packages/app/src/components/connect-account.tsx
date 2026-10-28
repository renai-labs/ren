import type { AppProfileInfo, AppProfileItem } from "@ren/client"
import { Credential } from "@ren/schema/credential"
import { Primitive } from "@ren/schema/primitive"
import { Avatar } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Dialog } from "@ren/ui/dialog"
import { Field } from "@ren/ui/field"
import { Form } from "@ren/ui/form"
import { Icon } from "@ren/ui/icon"
import { InlineEdit } from "@ren/ui/inline-edit"
import { List } from "@ren/ui/list"
import { Notice } from "@ren/ui/notice"
import { ProgressIndicator } from "@ren/ui/progress-indicator"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { Platform } from "../platform/platform.js"
import { AccountAccess } from "./account-access.js"
import { Apps } from "./apps.js"
import { Credentials } from "./credentials.js"

const KeyForm = Schema.toStandardSchemaV1(
  Schema.Struct({
    hosts: Credential.HostsText,
    value: Schema.NonEmptyString.annotate({ message: "Paste the key." }),
  }),
)

type Mcps = Readonly<Record<string, { readonly transport: { readonly type: string }; readonly auth: object }>>

const signsIn = (item: AppProfileItem) => item.kind === "oauth" || item.kind === "provider"

const declarationOf = (item: AppProfileItem, mcps: Mcps) => ("mcp" in item.item ? mcps[item.item.mcp] : undefined)

const fieldOf = (item: AppProfileItem, mcps: Mcps) => {
  const auth = declarationOf(item, mcps)?.auth
  return auth && "credential" in auth && typeof auth.credential === "string" ? auth.credential : undefined
}

const hostOf = (item: AppProfileItem, mcps: Mcps) => {
  const transport = declarationOf(item, mcps)?.transport
  return transport && "url" in transport && typeof transport.url === "string"
    ? (URL.parse(transport.url)?.hostname ?? "")
    : ""
}

// oxlint-disable-next-line ren/no-comments -- ren-v1 AppConnectionModal: the app first, one row per item, a sign-in in a new tab with a waiting state, keys pasted in place, and a done state. Edit changes the account's name and spaces.
function useAccount(profileId: string, options: { readonly polling: boolean }) {
  const context = RouterContext.useRouterContext()
  const profile = useQuery({
    ...context.api["app-profile"].get.queryOptions({ idOrSlug: profileId }),
    refetchOnWindowFocus: "always",
    refetchInterval: options.polling ? 2000 : false,
  })
  const app = useQuery({
    ...context.api.app.get.queryOptions({ idOrSlug: profile.data?.appId ?? "" }),
    enabled: Boolean(profile.data),
  })
  return {
    profile: profile.data,
    name: app.data?.name ?? profile.data?.appSlug ?? "",
    icon: app.data?.icon ?? undefined,
    mcps: app.data?.mcps ?? {},
  }
}

// oxlint-disable-next-line ren/no-comments -- ren-v1 AppConnectionModal: the app first, one row per item, a sign-in in a new tab with a waiting state, keys pasted in place, and a done state. Edit changes the account's name and spaces.
export function ConnectAccount(props: { profileId: string; onClose: () => void }) {
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(() => new Set())
  const [editing, setEditing] = useState(false)
  const account = useAccount(props.profileId, { polling: waiting.size > 0 })
  const found = account.profile
  if (!found) return null
  const done = found.items.every((item) => item.optional || item.status === "ok")
  return (
    <>
      <Header
        name={account.name}
        icon={account.icon}
        caption={`${found.name} account · ${Apps.reach(found)}`}
        editing={editing}
        onToggle={() => setEditing((current) => !current)}
      />
      <Dialog.Body>
        {editing ? (
          <EditAccount profile={found} />
        ) : (
          <Items
            profile={found}
            mcps={account.mcps}
            waiting={waiting}
            onWaiting={(label) => setWaiting((current) => new Set([...current, label]))}
          />
        )}
      </Dialog.Body>
      {done && !editing ? <Connected profile={found} onDone={props.onClose} /> : null}
    </>
  )
}

function Header(props: {
  name: string
  icon: string | undefined
  caption: string
  editing: boolean
  onToggle: () => void
}) {
  return (
    <Dialog.Header>
      <div className="flex items-start gap-3 pr-8">
        <Avatar.Root name={props.name} image={props.icon} size="feature" shape="square" imageFit="contain" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Dialog.Title>{`Connect ${props.name}`}</Dialog.Title>
          <Dialog.Description>{props.caption}</Dialog.Description>
        </div>
        <Button appearance="link" size="small" onClick={props.onToggle}>
          {props.editing ? "Back" : "Edit"}
        </Button>
      </div>
    </Dialog.Header>
  )
}

function Connected(props: { profile: AppProfileInfo; onDone: () => void }) {
  const holder = props.profile.items.find((item) => item.holder)?.holder
  return (
    <Dialog.Footer alignment="split">
      <Text purpose="body" tone="secondary" leadingIcon={<Icon glyph="Check" tone="success" />}>
        {holder ? `Connected as ${holder.name}` : "Connected"}
      </Text>
      <Button appearance="primary" size="small" onClick={props.onDone}>
        Done
      </Button>
    </Dialog.Footer>
  )
}

function Items(props: {
  profile: AppProfileInfo
  mcps: Mcps
  waiting: ReadonlySet<string>
  onWaiting: (label: string) => void
}) {
  const context = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const connect = useMutation(context.api["credential-connect"].credential.connect.mutationOptions())
  const signIn = (item: AppProfileItem) => {
    if (!("mcp" in item.item)) return
    connect.mutate(
      { profileId: props.profile.id, item: item.item, ...(item.status !== "missing" && { reconnect: true }) },
      {
        onSuccess: (result) => {
          if (!("redirectUrl" in result)) return
          props.onWaiting(item.label)
          platform.openExternal(result.redirectUrl)
        },
      },
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {props.profile.oauthApps
        .filter((gate) => !gate.isConfigured)
        .map((gate) => (
          <Notice key={gate.name} tone="warning" placement="inline">
            {`Set up the org OAuth app “${gate.name}” before you sign in.`}
          </Notice>
        ))}
      <List.Root label="Accounts">
        {props.profile.items.map((item) =>
          signsIn(item) ? (
            <SignInRow
              key={item.label}
              item={item}
              waiting={props.waiting.has(item.label) && item.status !== "ok"}
              pending={connect.isPending}
              onSignIn={() => signIn(item)}
            />
          ) : (
            <KeyRow
              key={item.label}
              profileId={props.profile.id}
              item={item}
              field={fieldOf(item, props.mcps)}
              host={hostOf(item, props.mcps)}
            />
          ),
        )}
      </List.Root>
      <Links profile={props.profile} />
      <Notice tone="danger" placement="inline">
        {connect.error?.message}
      </Notice>
    </div>
  )
}

const signInCaption = (item: AppProfileItem) => {
  if (item.status === "ok") return item.holder ? `Connected as ${item.holder.name}` : "Connected"
  if (item.status === "reconnect") return "Sign in again to keep it working."
  if (item.status === "unavailable") return "Not available in this organization."
  return `Opens ${item.name} in a new tab.`
}

function SignInRow(props: { item: AppProfileItem; waiting: boolean; pending: boolean; onSignIn: () => void }) {
  if (props.waiting)
    return (
      <List.Item
        title={props.item.name}
        description={`Waiting for ${props.item.name}…`}
        leading={<ProgressIndicator size="small" />}
        trailing={
          <Button appearance="link" size="small" onClick={props.onSignIn}>
            Open again
          </Button>
        }
      />
    )
  return (
    <List.Item
      title={props.item.name}
      description={signInCaption(props.item)}
      leading={props.item.status === "ok" ? <Icon glyph="Check" tone="success" /> : undefined}
      trailing={
        props.item.status === "unavailable" ? undefined : (
          <Button
            appearance={props.item.status === "ok" ? "secondary" : "primary"}
            size="small"
            pending={props.pending}
            onClick={props.onSignIn}
          >
            {props.item.status === "ok" ? "Reconnect" : `Sign in with ${props.item.name}`}
          </Button>
        )
      }
    />
  )
}

function KeyRow(props: { profileId: string; item: AppProfileItem; field: string | undefined; host: string }) {
  const context = RouterContext.useRouterContext()
  const create = useMutation(context.api.credential.create.mutationOptions())
  const [replacing, setReplacing] = useState(false)
  const form = Form.useForm({
    defaultValues: { hosts: props.host, value: "" },
    schema: KeyForm,
    onSubmit: async (value) => {
      const saved = await create
        .mutateAsync({
          payload: {
            owner: { kind: "profile", profileId: props.profileId },
            item: props.item.item,
            hosts: Credentials.hosts(value.hosts),
            value: props.field
              ? { type: "fields", fields: { [props.field]: value.value } }
              : { type: "key", value: value.value },
          },
        })
        .catch(() => undefined)
      if (!saved) return
      setReplacing(false)
      form.reset()
    },
  })
  if (props.item.status === "ok" && !replacing)
    return (
      <List.Item
        title={props.item.name}
        description="Saved"
        leading={<Icon glyph="Check" tone="success" />}
        trailing={
          <Button appearance="secondary" size="small" onClick={() => setReplacing(true)}>
            Replace
          </Button>
        }
      />
    )
  return (
    <Form.Root form={form}>
      <form.AppField name="value">
        {(field) => <field.PasswordField label={props.item.name} placeholder="Paste the key" autoComplete="off" />}
      </form.AppField>
      {props.host ? null : (
        <form.AppField name="hosts">
          {(field) => (
            <field.TextField
              label="Websites"
              description="Ren adds the key only to requests to these hosts."
              placeholder="api.example.com"
            />
          )}
        </form.AppField>
      )}
      <Notice tone="danger" placement="inline">
        {create.error?.message}
      </Notice>
      <form.SubmitButton pendingLabel="Saving…">Save</form.SubmitButton>
    </Form.Root>
  )
}

function EditAccount(props: { profile: AppProfileInfo }) {
  const context = RouterContext.useRouterContext()
  const authed = useRouteContext({ from: "/_authed" })
  const spaces = useQuery(context.api.space.list.queryOptions(Apps.page))
  const update = useMutation(context.api["app-profile"].update.mutationOptions())
  return (
    <div className="flex flex-col gap-4">
      <Field.Root label="Name" orientation="row">
        <InlineEdit
          label="Account name"
          alignment="end"
          required
          schema={Schema.toStandardSchemaV1(Primitive.Name)}
          value={props.profile.name}
          onCommit={(name) => update.mutateAsync({ id: props.profile.id, name })}
        />
      </Field.Root>
      <Field.Root label="Used in" orientation="row" description={Apps.reach(props.profile)}>
        <AccountAccess profile={props.profile} spaces={spaces.data?.items ?? []} userId={authed.me.user.id} />
      </Field.Root>
      <Notice tone="danger" placement="inline">
        {update.error?.message}
      </Notice>
    </div>
  )
}

// oxlint-disable-next-line ren/no-comments -- §9 rule 10 (P8): one section per dependency app with items; a missing link is a gap and does not block.
function Links(props: { profile: AppProfileInfo }) {
  const context = RouterContext.useRouterContext()
  const link = useMutation(context.api["app-profile"].link.mutationOptions())
  const candidates = useQuery({
    ...context.api["app-profile"].list.queryOptions(Apps.page),
    enabled: props.profile.links.length > 0,
  })
  if (props.profile.links.length === 0) return null
  return (
    <List.Root label="Dependencies">
      {props.profile.links.map((each) => {
        const options = (candidates.data?.items ?? [])
          .filter(
            (option) =>
              option.appId === each.appId &&
              (option.kind === "shared" ||
                (props.profile.kind === "private" && option.userId === props.profile.userId)),
          )
          .map((option) => ({ value: option.id, label: `${option.appSlug} · ${option.name}` }))
        return (
          <List.Item
            key={each.appId}
            title={options.at(0)?.label.split(" · ").at(0) ?? "Dependency"}
            description={each.profileId ? "Linked" : "Not linked"}
            trailing={
              <Select.Root
                label="Account to use"
                value={each.profileId}
                options={options}
                onValueChange={(profileId) =>
                  void link.mutateAsync({ id: props.profile.id, appId: each.appId, profileId }).catch(() => undefined)
                }
              />
            }
          />
        )
      })}
    </List.Root>
  )
}
