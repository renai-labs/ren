import type { AppProfileInfo, AppProfileItem } from "@ren/client"
import { AppProfile } from "@ren/schema/app-profile"
import { Credential } from "@ren/schema/credential"
import { Pagination } from "@ren/schema/pagination"
import { Primitive } from "@ren/schema/primitive"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Checkbox } from "@ren/ui/checkbox"
import { Dialog } from "@ren/ui/dialog"
import { Field } from "@ren/ui/field"
import { Form } from "@ren/ui/form"
import { List } from "@ren/ui/list"
import { Notice } from "@ren/ui/notice"
import { RadioGroup } from "@ren/ui/radio-group"
import { Select } from "@ren/ui/select"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Schema } from "effect"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { Platform } from "../platform/platform.js"
import { Credentials } from "./credentials.js"
import { Profiles } from "./profiles.js"

const CreateForm = Schema.toStandardSchemaV1(
  Schema.Struct({ name: Primitive.Name, slug: AppProfile.Slug, kind: AppProfile.Kind }),
)

const PasteForm = Schema.toStandardSchemaV1(
  Schema.Struct({
    hosts: Credential.HostsText,
    value: Schema.NonEmptyString.annotate({ message: "Paste the key." }),
  }),
)

const statusBadge = {
  ok: { label: "Connected", tone: "success" },
  missing: { label: "Not connected", tone: "neutral" },
  reconnect: { label: "Reconnect", tone: "danger" },
  unavailable: { label: "Unavailable", tone: "warning" },
} as const

const page = { page: 1, pageSize: Pagination.maximumPageSize }

// oxlint-disable-next-line ren/no-comments -- profiles.md §9 (P12): name and slug, then shared or private, then spaces; the profile exists from the first save. Its items and dependencies follow in the same dialog.
export function ProfileDialog(props: {
  appId: string
  profileId?: string
  from?: { readonly spaceId: string; readonly members: number }
  onClose: () => void
}) {
  const [profileId, setProfileId] = useState(props.profileId)
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <Dialog.Content>
        {profileId ? (
          <ProfileItems profileId={profileId} />
        ) : (
          <CreateProfile appId={props.appId} from={props.from} onCreated={setProfileId} />
        )}
      </Dialog.Content>
    </Dialog.Root>
  )
}

function CreateProfile(props: {
  appId: string
  from: { readonly spaceId: string; readonly members: number } | undefined
  onCreated: (id: string) => void
}) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const create = useMutation(context.api["app-profile"].create.mutationOptions())
  const spaces = useQuery(context.api.space.list.queryOptions(page))
  const kinds = Profiles.kinds(props.from)
  const [listed, setListed] = useState<ReadonlySet<string>>(() => new Set(props.from ? [props.from.spaceId] : []))
  const form = Form.useForm({
    defaultValues: { name: "", slug: "", kind: kinds.at(0) ?? "shared" },
    schema: CreateForm,
    onSubmit: async (value) => {
      const created = await create
        .mutateAsync({
          appId: props.appId,
          name: value.name,
          slug: value.slug,
          kind: value.kind,
          ...(value.kind === "shared" && { spaceIds: [...listed] }),
        })
        .catch(() => undefined)
      if (!created) return
      await queryClient.invalidateQueries({ queryKey: context.api["app-profile"].list.queryKey() })
      props.onCreated(created.id)
    },
  })
  return (
    <>
      <Dialog.Header>
        <Dialog.Title>New profile</Dialog.Title>
        <Dialog.Description>
          A profile is one set of accounts for the app. The agent tells profiles apart by their name.
        </Dialog.Description>
      </Dialog.Header>
      <Form.Root form={form} arrangement="contents">
        <Dialog.Body>
          <form.AppField
            name="name"
            listeners={{ onChange: (event) => form.setFieldValue("slug", Profiles.slugOf(event.value)) }}
          >
            {(field) => <field.TextField label="Name" placeholder="Acme client" />}
          </form.AppField>
          <form.AppField name="slug">
            {(field) => (
              <field.TextField
                label="Slug"
                description="It names the profile’s servers and keys, such as gmail__acme. It cannot change later."
                placeholder="acme"
              />
            )}
          </form.AppField>
          {kinds.length > 1 ? (
            <form.AppField name="kind">
              {(field) => (
                <field.RadioGroup label="Who uses it">
                  <RadioGroup.Item value="shared" label="Shared" description="The spaces you pick use it." />
                  <RadioGroup.Item value="private" label="Private" description="Only your Personal Space uses it." />
                </field.RadioGroup>
              )}
            </form.AppField>
          ) : null}
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === "shared" ? (
                <Field.Root label="Spaces">
                  <span className="flex flex-col gap-2">
                    {(spaces.data?.items ?? []).map((space) => (
                      <Checkbox
                        key={space.id}
                        label={space.name}
                        labelVisibility="visible"
                        checked={listed.has(space.id)}
                        onCheckedChange={(checked) =>
                          setListed((current) => {
                            const next = new Set(current)
                            if (checked) next.add(space.id)
                            else next.delete(space.id)
                            return next
                          })
                        }
                      />
                    ))}
                  </span>
                </Field.Root>
              ) : null
            }
          </form.Subscribe>
          <Notice tone="danger" placement="inline">
            {create.error?.message}
          </Notice>
        </Dialog.Body>
        <Dialog.Footer>
          <form.SubmitButton pendingLabel="Creating…">Create profile</form.SubmitButton>
        </Dialog.Footer>
      </Form.Root>
    </>
  )
}

// oxlint-disable-next-line ren/no-comments -- §9 rules 5, 6, 10 and 11: a sign-in opens in a new tab and the list asks again when the window gets focus; a paste goes to the profile, which computes its label. Who can use an account shows before a sign-in.
function ProfileItems(props: { profileId: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const platform = Platform.usePlatform()
  const profile = useQuery({
    ...context.api["app-profile"].get.queryOptions({ idOrSlug: props.profileId }),
    refetchOnWindowFocus: "always",
  })
  const app = useQuery({
    ...context.api.app.get.queryOptions({ idOrSlug: profile.data?.appId ?? "" }),
    enabled: Boolean(profile.data),
  })
  const connect = useMutation(context.api["credential-connect"].credential.connect.mutationOptions())
  const [pasting, setPasting] = useState<AppProfileItem>()
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: context.api["app-profile"].get.queryKey() }),
      queryClient.invalidateQueries({ queryKey: context.api["app-profile"].list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: context.api["app-profile-reach"].space.profiles.queryKey() }),
      queryClient.invalidateQueries({ queryKey: context.api["app-profile-reach"].session.profiles.queryKey() }),
    ])
  const found = profile.data
  if (!found) return null
  const signIn = (item: AppProfileItem) => {
    if (!("mcp" in item.item)) return
    void connect
      .mutateAsync({ profileId: found.id, item: item.item, ...(item.status === "reconnect" && { reconnect: true }) })
      .then(async (result) => {
        if ("redirectUrl" in result) platform.openExternal(result.redirectUrl)
        else await refresh()
      })
      .catch(() => undefined)
  }
  const mcps = app.data?.mcps ?? {}
  return (
    <>
      <Dialog.Header>
        <Dialog.Title>{found.name}</Dialog.Title>
        <Dialog.Description>{Profiles.audience(found)}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        {found.oauthApps
          .filter((gate) => !gate.isConfigured)
          .map((gate) => (
            <Notice key={gate.name} tone="warning" placement="inline">
              {`Set up the org OAuth app “${gate.name}” before you sign in.`}
            </Notice>
          ))}
        {found.skipped.map((skipped) => (
          <Notice key={`${skipped.kind}/${skipped.slug}`} tone="warning" placement="inline">
            {`${skipped.slug} skipped: also in ${skipped.also}.`}
          </Notice>
        ))}
        <List.Root label="Accounts">
          {found.items.map((item) => {
            const badge = statusBadge[item.status]
            return (
              <List.Item
                key={item.label}
                title={item.name}
                description={item.holder ? `${item.label} · ${item.holder.name}’s account` : item.label}
                trailing={
                  <span className="flex items-center gap-2">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    <ItemAction
                      item={item}
                      pending={connect.isPending}
                      onSignIn={() => signIn(item)}
                      onPaste={() => setPasting(item)}
                    />
                  </span>
                }
              />
            )
          })}
        </List.Root>
        <Links profile={found} onChanged={refresh} />
        <Notice tone="danger" placement="inline">
          {(connect.error ?? profile.error)?.message}
        </Notice>
      </Dialog.Body>
      {pasting ? (
        <PasteItemDialog
          profileId={found.id}
          item={pasting}
          field={fieldOf(pasting, mcps)}
          host={hostOf(pasting, mcps)}
          onClose={() => setPasting(undefined)}
          onSaved={refresh}
        />
      ) : null}
    </>
  )
}

type Mcps = Readonly<Record<string, { readonly transport: { readonly type: string }; readonly auth: object }>>

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

function ItemAction(props: { item: AppProfileItem; pending: boolean; onSignIn: () => void; onPaste: () => void }) {
  if (props.item.status === "unavailable") return null
  if (props.item.kind === "env" || props.item.kind === "fields")
    return (
      <Button appearance="secondary" size="small" onClick={props.onPaste}>
        {props.item.status === "ok" ? "Replace key" : "Add key"}
      </Button>
    )
  return (
    <Button
      appearance={props.item.status === "ok" ? "secondary" : "primary"}
      size="small"
      disabled={props.pending}
      onClick={props.onSignIn}
    >
      {props.item.status === "missing" ? "Connect" : "Reconnect"}
    </Button>
  )
}

// oxlint-disable-next-line ren/no-comments -- §9 rule 10 (P8): one section per dependency app with items; a missing link is a gap and does not block.
function Links(props: { profile: AppProfileInfo; onChanged: () => Promise<unknown> }) {
  const context = RouterContext.useRouterContext()
  const link = useMutation(context.api["app-profile"].link.mutationOptions())
  const candidates = useQuery({
    ...context.api["app-profile"].list.queryOptions(page),
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
              (option.kind === "shared" || (props.profile.kind === "private" && option.userId === props.profile.userId)),
          )
          .map((option) => ({ value: option.id, label: `${option.appSlug} · ${option.name}` }))
        return (
          <List.Item
            key={each.appId}
            title={options.at(0)?.label.split(" · ").at(0) ?? "Dependency"}
            description={each.profileId ? "Linked" : "Not linked"}
            trailing={
              <Select.Root
                label="Profile to use"
                value={each.profileId}
                options={options}
                onValueChange={(profileId) =>
                  void link
                    .mutateAsync({ id: props.profile.id, appId: each.appId, profileId })
                    .then(props.onChanged)
                    .catch(() => undefined)
                }
              />
            }
          />
        )
      })}
    </List.Root>
  )
}

function PasteItemDialog(props: {
  profileId: string
  item: AppProfileItem
  field: string | undefined
  host: string
  onClose: () => void
  onSaved: () => Promise<unknown>
}) {
  const context = RouterContext.useRouterContext()
  const create = useMutation(context.api.credential.create.mutationOptions())
  const form = Form.useForm({
    defaultValues: { hosts: props.host, value: "" },
    schema: PasteForm,
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
      await props.onSaved()
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
          <Dialog.Title>{`Add ${props.item.name}`}</Dialog.Title>
          <Dialog.Description>{`Chats see it as ${props.item.label}.`}</Dialog.Description>
        </Dialog.Header>
        <Form.Root form={form} arrangement="contents">
          <Dialog.Body>
            <form.AppField name="hosts">
              {(field) => (
                <field.TextField
                  label="Hosts"
                  description="Only requests to these hosts get the key."
                  placeholder="api.stripe.com"
                />
              )}
            </form.AppField>
            <form.AppField name="value">
              {(field) => <field.PasswordField label="Key" placeholder="sk_live_…" />}
            </form.AppField>
            <Notice tone="danger" placement="inline">
              {create.error?.message}
            </Notice>
          </Dialog.Body>
          <Dialog.Footer>
            <form.SubmitButton pendingLabel="Saving…">Save key</form.SubmitButton>
          </Dialog.Footer>
        </Form.Root>
      </Dialog.Content>
    </Dialog.Root>
  )
}
