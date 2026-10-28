import type { AppProfileInfo, AppProfileItem } from "@ren/client"
import { Credential } from "@ren/schema/credential"
import { Primitive } from "@ren/schema/primitive"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Form } from "@ren/ui/form"
import { Icon } from "@ren/ui/icon"
import { InlineEdit } from "@ren/ui/inline-edit"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@ren/ui/item"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Initials } from "@ren/util/initials"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { Schema } from "effect"
import { Fragment, useState } from "react"
import type { ReactNode } from "react"
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
  if (!found)
    return (
      <DialogContent>
        <DialogTitle className="sr-only">Connect account</DialogTitle>
        <Spinner className="mx-auto my-8 text-muted-foreground" />
      </DialogContent>
    )
  const done = found.items.every((item) => item.optional || item.status === "ok")
  return (
    <DialogContent>
      <DialogHeader className="flex-row items-start gap-3 pr-8">
        <Avatar size="lg" className="rounded-lg after:rounded-lg">
          <AvatarImage src={account.icon} alt={account.name} className="m-auto size-3/4 rounded-none object-contain" />
          <AvatarFallback className="rounded-lg">{Initials.of(account.name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <DialogTitle>{`Connect ${account.name}`}</DialogTitle>
          <DialogDescription>{`${found.name} account · ${Apps.reach(found)}`}</DialogDescription>
        </div>
        <Button
          variant="ghost"
          size="xs"
          className="h-6.5 text-muted-foreground"
          onClick={() => setEditing((current) => !current)}
        >
          {editing ? "Back" : "Edit"}
        </Button>
      </DialogHeader>
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
      {done && !editing ? <Connected profile={found} onDone={props.onClose} /> : null}
    </DialogContent>
  )
}

function Connected(props: { profile: AppProfileInfo; onDone: () => void }) {
  const holder = props.profile.items.find((item) => item.holder)?.holder
  return (
    <DialogFooter className="items-center">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon glyph="Check" tone="success" />
        {holder ? `Connected as ${holder.name}` : "Connected"}
      </span>
      <Button onClick={props.onDone}>Done</Button>
    </DialogFooter>
  )
}

function Row(props: { title: string; description?: string; media?: ReactNode; children?: ReactNode }) {
  return (
    <Item render={<li />} className="min-h-14 gap-x-6 gap-y-2 px-4 py-3">
      {props.media ? <ItemMedia>{props.media}</ItemMedia> : null}
      <ItemContent>
        <ItemTitle className="leading-5">{props.title}</ItemTitle>
        {props.description ? <ItemDescription className="text-xs">{props.description}</ItemDescription> : null}
      </ItemContent>
      {props.children ? <ItemActions>{props.children}</ItemActions> : null}
    </Item>
  )
}

function Failure(props: { message: string | undefined }) {
  if (!props.message) return null
  return (
    <Alert variant="destructive">
      <Icon glyph="AlertCircle" />
      <AlertDescription>{props.message}</AlertDescription>
    </Alert>
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
          <Alert key={gate.name}>
            <Icon glyph="AlertTriangle" tone="warning" />
            <AlertDescription>{`Set up the org OAuth app “${gate.name}” before you sign in.`}</AlertDescription>
          </Alert>
        ))}
      <ItemGroup aria-label="Accounts" className="gap-0 rounded-xl border bg-card">
        {props.profile.items.map((item, index) => (
          <Fragment key={item.label}>
            {index > 0 ? <ItemSeparator className="my-0" /> : null}
            {signsIn(item) ? (
              <SignInRow
                item={item}
                waiting={props.waiting.has(item.label) && item.status !== "ok"}
                pending={connect.isPending}
                onSignIn={() => signIn(item)}
              />
            ) : (
              <KeyRow
                profileId={props.profile.id}
                item={item}
                field={fieldOf(item, props.mcps)}
                host={hostOf(item, props.mcps)}
              />
            )}
          </Fragment>
        ))}
      </ItemGroup>
      <Links profile={props.profile} />
      <Failure message={connect.error?.message} />
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
      <Row title={props.item.name} description={`Waiting for ${props.item.name}…`} media={<Spinner />}>
        <Button variant="ghost" size="xs" className="h-6.5 text-muted-foreground" onClick={props.onSignIn}>
          Open again
        </Button>
      </Row>
    )
  const ok = props.item.status === "ok"
  return (
    <Row
      title={props.item.name}
      description={signInCaption(props.item)}
      media={ok ? <Icon glyph="Check" tone="success" /> : undefined}
    >
      {props.item.status === "unavailable" ? null : (
        <Button
          variant={ok ? "outline" : "default"}
          size="xs"
          className="h-6.5"
          disabled={props.pending}
          onClick={props.onSignIn}
        >
          {props.pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          {ok ? "Reconnect" : `Sign in with ${props.item.name}`}
        </Button>
      )}
    </Row>
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
      <Row title={props.item.name} description="Saved" media={<Icon glyph="Check" tone="success" />}>
        <Button variant="outline" size="xs" className="h-6.5" onClick={() => setReplacing(true)}>
          Replace
        </Button>
      </Row>
    )
  return (
    <li className="px-4 py-3">
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
        <Failure message={create.error?.message} />
        <form.SubmitButton pendingLabel="Saving…">Save</form.SubmitButton>
      </Form.Root>
    </li>
  )
}

function EditAccount(props: { profile: AppProfileInfo }) {
  const context = RouterContext.useRouterContext()
  const authed = useRouteContext({ from: "/_authed" })
  const spaces = useQuery(context.api.space.list.queryOptions(Apps.page))
  const update = useMutation(context.api["app-profile"].update.mutationOptions())
  return (
    <div className="flex flex-col gap-4">
      <ItemGroup aria-label="Account" className="gap-0 rounded-xl border bg-card">
        <Row title="Name">
          <InlineEdit
            label="Account name"
            alignment="end"
            required
            schema={Schema.toStandardSchemaV1(Primitive.Name)}
            value={props.profile.name}
            onCommit={(name) => update.mutateAsync({ id: props.profile.id, name })}
          />
        </Row>
        <ItemSeparator className="my-0" />
        <Row title="Used in" description={Apps.reach(props.profile)}>
          <AccountAccess profile={props.profile} spaces={spaces.data?.items ?? []} userId={authed.me.user.id} />
        </Row>
      </ItemGroup>
      <Failure message={update.error?.message} />
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
    <ItemGroup aria-label="Dependencies" className="gap-0 rounded-xl border bg-card">
      {props.profile.links.map((each, index) => {
        const options = (candidates.data?.items ?? [])
          .filter(
            (option) =>
              option.appId === each.appId &&
              (option.kind === "shared" ||
                (props.profile.kind === "private" && option.userId === props.profile.userId)),
          )
          .map((option) => ({ value: option.id, label: `${option.appSlug} · ${option.name}` }))
        return (
          <Fragment key={each.appId}>
            {index > 0 ? <ItemSeparator className="my-0" /> : null}
            <Row
              title={options.at(0)?.label.split(" · ").at(0) ?? "Dependency"}
              description={each.profileId ? "Linked" : "Not linked"}
            >
              <Select
                items={options}
                value={each.profileId}
                onValueChange={(profileId) => {
                  if (profileId)
                    void link.mutateAsync({ id: props.profile.id, appId: each.appId, profileId }).catch(() => undefined)
                }}
              >
                <SelectTrigger size="sm" aria-label="Account to use">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Row>
          </Fragment>
        )
      })}
    </ItemGroup>
  )
}
