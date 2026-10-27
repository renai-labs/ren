import { useState } from "react"
import type { AppProfileInfo, AppProfileItem } from "@ren/client"
import { Credential } from "@ren/schema/credential"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { AccountAccess } from "@/components/ren/account-actions"
import { AppIcon } from "@/components/ren/app-icon"
import { EditableText } from "@/components/ren/editable-text"
import { Row, Rows } from "@/components/ren/page"
import { useCatalog } from "@/hooks/use-catalog"
import { useSignIn } from "@/hooks/use-sign-in"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage, profileQueries } from "@/lib/api"
import { kinds, reach, signsIn, slugOf, type CatalogApp } from "@/lib/apps"
import { formText } from "@/lib/format"

type App = CatalogApp
type AppProfile = AppProfileInfo

export type ProfileTarget = {
  appId: string
  profileId?: string | undefined
  from?: { spaceId: string; name: string; members: number } | undefined
}

export function ProfileDialog(props: ProfileTarget & { onClose: () => void }) {
  const app = useCatalog().appOf(props.appId)
  const [profileId, setProfileId] = useState(props.profileId)
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(() => new Set())
  const found = useQuery({
    ...api["app-profile"].get.queryOptions({ idOrSlug: profileId ?? "" }),
    enabled: Boolean(profileId),
    refetchOnWindowFocus: "always",
    refetchInterval: waiting.size > 0 ? 2000 : false,
  })
  const profile = found.data
  if (!app) return null
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent>
        {profile ? (
          <ConnectAccount
            app={app}
            profile={profile}
            waiting={waiting}
            onWaiting={(label) => setWaiting((current) => new Set([...current, label]))}
            onDone={props.onClose}
          />
        ) : profileId ? (
          <Spinner className="mx-auto my-8 text-muted-foreground" />
        ) : (
          <CreateProfile app={app} from={props.from} onCreated={(created) => setProfileId(created.id)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateProfile(props: {
  app: App
  from?: { spaceId: string; name: string; members: number } | undefined
  onCreated: (profile: AppProfile) => void
}) {
  const offered = kinds(props.from)
  const allSpaces = useSpaces().joined
  const create = useMutation({ ...api["app-profile"].create.mutationOptions(), meta: { invalidates: profileQueries } })
  const [name, setName] = useState(props.from?.name ?? "")
  const [slug, setSlug] = useState(() => slugOf(props.from?.name ?? ""))
  const [slugEdited, setSlugEdited] = useState(false)
  const [kind, setKind] = useState<AppProfile["kind"]>(offered[0])
  const [spaces, setSpaces] = useState<ReadonlySet<string>>(
    () => new Set(props.from ? [props.from.spaceId] : [])
  )
  const [noSpace, setNoSpace] = useState(false)
  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (kind === "shared" && spaces.size === 0) return setNoSpace(true)
    create.mutate(
      {
        appId: props.app.id,
        name: name.trim(),
        slug,
        kind,
        ...(kind === "shared" && { spaceIds: [...spaces] }),
      },
      { onSuccess: props.onCreated },
    )
  }
  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>New profile</DialogTitle>
        <DialogDescription>
          A profile is one set of accounts for {props.app.name}. The agent tells
          profiles apart by their name.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-5">
        <Field>
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <Input
            id="profile-name"
            required
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to take this name
            autoFocus
            placeholder="Acme client"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (!slugEdited) setSlug(slugOf(event.target.value))
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="profile-slug">Slug</FieldLabel>
          <Input
            id="profile-slug"
            required
            placeholder="acme"
            className="font-mono"
            value={slug}
            onChange={(event) => {
              setSlugEdited(true)
              setSlug(slugOf(event.target.value))
            }}
          />
          <FieldDescription>
            It names the profile’s servers and keys, such as {props.app.slug}__
            {slug || "acme"}. It cannot change later.
          </FieldDescription>
        </Field>
        {offered.length > 1 ? (
          <FieldSet>
            <FieldLegend variant="label">Who uses it</FieldLegend>
            <RadioGroup
              value={kind}
              onValueChange={(value) => setKind(value === "private" ? "private" : "shared")}
              className="grid-cols-2"
            >
              <Choice
                value="shared"
                title="Shared"
                description="The spaces you pick use it."
              />
              <Choice
                value="private"
                title="Private"
                description="Only your Personal Space uses it."
              />
            </RadioGroup>
          </FieldSet>
        ) : null}
        {kind === "shared" ? (
          <FieldSet data-invalid={noSpace && spaces.size === 0}>
            <FieldLegend variant="label">Spaces</FieldLegend>
            <div className="flex flex-col gap-3">
              {allSpaces.map((space) => (
                <Field key={space.id} orientation="horizontal">
                  <Checkbox
                    id={`profile-space-${space.id}`}
                    checked={spaces.has(space.id)}
                    onCheckedChange={(checked) =>
                      setSpaces((current) => {
                        const next = new Set(current)
                        if (checked) next.add(space.id)
                        else next.delete(space.id)
                        return next
                      })
                    }
                  />
                  <FieldLabel
                    htmlFor={`profile-space-${space.id}`}
                    className="font-normal"
                  >
                    {space.name}
                  </FieldLabel>
                </Field>
              ))}
            </div>
            {noSpace && spaces.size === 0 ? (
              <FieldError>Pick at least one space.</FieldError>
            ) : null}
          </FieldSet>
        ) : null}
        {create.error ? <FieldError>{errorMessage(create.error)}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner data-icon="inline-start" /> : null}
          Create profile
        </Button>
      </DialogFooter>
    </form>
  )
}

function Choice(props: { value: string; title: string; description: string }) {
  const id = `profile-kind-${props.value}`
  return (
    <FieldLabel htmlFor={id}>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>{props.title}</FieldTitle>
          <FieldDescription className="text-xs">
            {props.description}
          </FieldDescription>
        </FieldContent>
        <RadioGroupItem value={props.value} id={id} />
      </Field>
    </FieldLabel>
  )
}

function ConnectAccount(props: {
  app: App
  profile: AppProfile
  waiting: ReadonlySet<string>
  onWaiting: (label: string) => void
  onDone: () => void
}) {
  const items = props.profile.items
  const [editing, setEditing] = useState(false)
  const signInFlow = useSignIn((item) => props.onWaiting(item.label))
  const rename = useMutation({ ...api["app-profile"].update.mutationOptions(), meta: { invalidates: profileQueries } })
  const signIn = (item: AppProfileItem) => signInFlow.start(props.profile.id, item)
  const done = items.every((item) => item.optional || item.status === "ok")
  const holder = items.find((item) => item.holder)?.holder
  return (
    <>
      <DialogHeader className="flex-row items-start gap-3 pr-8">
        <AppIcon name={props.app.name} icon={props.app.icon} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <DialogTitle>Connect {props.app.name}</DialogTitle>
          <DialogDescription>
            {props.profile.name} account · {reach(props.profile)}
          </DialogDescription>
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
        <Rows>
          {[
            <Row key="name" title="Name">
              <EditableText
                value={props.profile.name}
                label="account name"
                required
                onCommit={(next) =>
                  rename.mutateAsync(
                    { id: props.profile.id, name: next },
                    { onError: (error) => toast.error("Couldn’t rename", { description: errorMessage(error) }) },
                  )
                }
              />
            </Row>,
            <Row
              key="spaces"
              title="Used in"
              description={reach(props.profile)}
            >
              <AccountAccess profile={props.profile} />
            </Row>,
          ]}
        </Rows>
      ) : (
        <div className="flex flex-col gap-3">
          {props.profile.oauthApps
            .filter((gate) => !gate.isConfigured)
            .map((gate) => (
              <Alert key={gate.name}>
                <IconAlertTriangle className="text-chart-3" />
                <AlertDescription>
                  Set up the org OAuth app “{gate.name}” before you sign in.
                </AlertDescription>
              </Alert>
            ))}
          <Rows>
            {items.map((item) =>
              signsIn(item) ? (
                <SignInRow
                  key={item.label}
                  item={item}
                  waiting={props.waiting.has(item.label) && item.status !== "ok"}
                  onSignIn={() => signIn(item)}
                />
              ) : (
                <KeyRow
                  key={item.label}
                  profileId={props.profile.id}
                  app={props.app}
                  item={item}
                />
              )
            )}
          </Rows>
        </div>
      )}
      {done && !editing ? (
        <DialogFooter className="items-center">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconCheck className="size-4 text-chart-2" />
            {holder ? `Connected as ${holder.name}` : "Connected"}
          </span>
          <Button onClick={props.onDone}>Done</Button>
        </DialogFooter>
      ) : null}
    </>
  )
}

const signInCaption = (item: AppProfileItem) => {
  if (item.status === "ok")
    return item.holder ? `Connected as ${item.holder.name}` : "Connected"
  if (item.status === "reconnect") return "Sign in again to keep it working."
  if (item.status === "unavailable")
    return "Not available in this organization."
  return `Opens ${item.name} in a new tab.`
}

function SignInRow(props: {
  item: AppProfileItem
  waiting: boolean
  onSignIn: () => void
}) {
  if (props.waiting)
    return (
      <Row
        title={props.item.name}
        description={`Waiting for ${props.item.name}…`}
        media={<Spinner className="text-muted-foreground" />}
      >
        <Button
          variant="ghost"
          size="xs"
          className="h-6.5 text-muted-foreground"
          onClick={props.onSignIn}
        >
          Open again
        </Button>
      </Row>
    )
  const ok = props.item.status === "ok"
  return (
    <Row
      title={props.item.name}
      description={signInCaption(props.item)}
      media={ok ? <IconCheck className="size-4 text-chart-2" /> : undefined}
    >
      {props.item.status === "unavailable" ? null : (
        <Button
          variant={ok ? "outline" : "default"}
          size="xs"
          className="h-6.5"
          onClick={props.onSignIn}
        >
          {ok ? "Reconnect" : `Sign in with ${props.item.name}`}
        </Button>
      )}
    </Row>
  )
}

function keyTarget(item: AppProfileItem, app: App) {
  const mcp = "mcp" in item.item ? app.mcps[item.item.mcp] : undefined
  const auth = mcp?.auth
  const transport = mcp?.transport
  return {
    field: auth?.type === "header" && typeof auth.credential === "string" ? auth.credential : undefined,
    host: transport?.type === "remote" ? (URL.parse(transport.url)?.hostname ?? "") : "",
  }
}

function KeyRow(props: { profileId: string; app: App; item: AppProfileItem }) {
  const [replacing, setReplacing] = useState(false)
  const create = useMutation({ ...api.credential.create.mutationOptions(), meta: { invalidates: profileQueries } })
  const target = keyTarget(props.item, props.app)
  if (props.item.status === "ok" && !replacing)
    return (
      <Row
        title={props.item.name}
        description="Saved"
        media={<IconCheck className="size-4 text-chart-2" />}
      >
        <Button
          variant="outline"
          size="xs"
          className="h-6.5"
          onClick={() => setReplacing(true)}
        >
          Replace
        </Button>
      </Row>
    )
  const id = `key-${props.item.label}`
  return (
    <form
      className="flex flex-col gap-2 px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const value = formText(form, "value").trim()
        const hosts = Credential.splitHosts(target.host || formText(form, "hosts"))
        if (!value || hosts.length === 0) return
        create.mutate(
          {
            payload: {
              owner: { kind: "profile", profileId: props.profileId },
              item: props.item.item,
              hosts,
              value: target.field ? { type: "fields", fields: { [target.field]: value } } : { type: "key", value },
            },
          },
          {
            onSuccess: () => {
              setReplacing(false)
              toast.success(`${props.item.name} saved`)
            },
          },
        )
      }}
    >
      <div className="flex items-end gap-2">
        <Field className="flex-1">
          <FieldLabel htmlFor={id}>{props.item.name}</FieldLabel>
          <Input
            id={id}
            name="value"
            type="password"
            required
            autoComplete="off"
            placeholder="Paste the key"
            className="font-mono"
          />
        </Field>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
      </div>
      {target.host ? null : (
        <Field>
          <FieldLabel htmlFor={`${id}-hosts`}>Websites</FieldLabel>
          <Input id={`${id}-hosts`} name="hosts" required placeholder="api.example.com" />
          <FieldDescription>Ren adds the key only to requests to these hosts.</FieldDescription>
        </Field>
      )}
      {create.error ? <FieldError>{errorMessage(create.error)}</FieldError> : null}
    </form>
  )
}
