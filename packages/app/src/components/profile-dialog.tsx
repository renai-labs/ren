import { SkeletonRows } from "./page.js"
import { useState, type ReactNode } from "react"
import type { AppProfileInfo, AppProfileItem, SpaceInfo } from "@ren/client"
import { Credential } from "@ren/schema/credential"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "@ren/ui/sonner"
import {
  IconAlertTriangle,
  IconBuilding,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconCube,
  IconDots,
  IconLock,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia } from "@ren/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { RadioGroup, RadioGroupItem } from "@ren/ui/radio-group"
import { Spinner } from "@ren/ui/spinner"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Switch } from "@ren/ui/switch"
import { AccountAccess } from "./account-actions.js"
import { toastRemoved } from "./space-removal.js"
import { AppIcon } from "./app-icon.js"
import { AccountList, SpacePills, StatusDot } from "./app-list.js"
import { ConfirmDialog } from "./confirm-dialog.js"
import { Row, Rows } from "./page.js"
import { Platform } from "../platform/platform.js"
import { useApp, useApps } from "../lib/use-app.js"
import { useAppProfiles } from "../lib/use-app-profiles.js"
import { useMembers } from "../lib/use-members.js"
import { useSignIn } from "../lib/use-sign-in.js"
import { useSpaces } from "../lib/use-spaces.js"
import { useMe } from "../lib/use-me.js"
import { errorMessage } from "../lib/errors.js"
import { plural } from "../lib/format.js"
import {
  gaps,
  hasManaged,
  lastSpaceWarning,
  listsSpace,
  reachedSpaces,
  signsIn,
  slugOf,
  statusLabel,
  statusOf,
  type CatalogApp,
  type Status,
} from "../lib/apps.js"
import { Search } from "../lib/search.js"
import { cn } from "cn"
import { useScrollEdges } from "../lib/use-scroll-edges.js"
import { RouterContext } from "../lib/router-context.js"

type App = CatalogApp
type AppProfile = AppProfileInfo
type From = { spaceId: string; name: string; members: number; private?: boolean }
type Mode = "resolve" | "reuse" | "fresh"

export type ProfileTarget = {
  appId: string
  profileId?: string | undefined
  from?: From | undefined
  edit?: boolean | undefined
  existing?: boolean | undefined
  newAccount?: boolean | undefined
  chooseSpace?: boolean | undefined
}

const freeSlug = (name: string, taken: ReadonlySet<string>) => {
  const base = slugOf(name) || "account"
  if (!taken.has(base)) return base
  const number = Array.from({ length: taken.size + 1 }, (_, index) => index + 2).find(
    (candidate) => !taken.has(`${base}-${candidate}`),
  )
  return `${base}-${number}`
}

function defaultName(input: {
  from: From | undefined
  only: boolean
  picked: ReadonlySet<string>
  spaces: ReadonlyArray<{ id: string; name: string }>
  others: ReadonlyArray<AppProfile>
  app: App
  user: string
}) {
  const first = input.user.split(" ").at(0)
  if (input.only || input.from?.private) return [input.app.name, first].join(" · ")
  const targets = input.from ? [input.from.spaceId] : [...input.picked]
  const chosen = input.spaces.filter((space) => input.picked.has(space.id))
  const space = input.from?.name ?? (chosen.length === 1 ? chosen.at(0)?.name : undefined)
  const isFirst = !input.others.some(
    (other) =>
      other.kind === "shared" && (other.allSpaces || other.spaces.some((listed) => targets.includes(listed.id))),
  )
  return [space, input.app.name, isFirst ? undefined : first].filter(Boolean).join(" · ")
}

export function useAddManaged() {
  const { api } = RouterContext.useRouterContext()
  const user = useMe().user.name
  const accounts = useAppProfiles([])
  const create = useMutation(api["app-profile"].create.mutationOptions())
  return async (app: App, from: From) => {
    const others = await accounts.load(app.id)
    const name = defaultName({ from, only: false, picked: new Set(), spaces: [], others, app, user })
    await create.mutateAsync({
      appId: app.id,
      name,
      slug: freeSlug(name, new Set(others.map((profile) => profile.slug))),
      kind: from.private ? "private" : "shared",
      ...(!from.private && { spaceIds: [from.spaceId] }),
    })
  }
}

const slideIn = "animate-in duration-250 ease-out fade-in-0 slide-in-from-right-4 motion-reduce:slide-in-from-right-0"
const slideBack = "animate-in duration-250 ease-out fade-in-0 slide-in-from-left-4 motion-reduce:slide-in-from-left-0"

const slides = { none: undefined, in: slideIn, back: slideBack }

function stepOf(input: {
  profileId: string | undefined
  existing: boolean
  edit: boolean
  section: "edit" | "connection"
  from: From | undefined
  chooseSpace: boolean
}) {
  if (input.existing) return "existing"
  if (input.profileId) return input.edit ? input.section : "connect"
  if (input.from) return "add"
  return input.chooseSpace ? "spaces" : "create"
}

export function ProfileDialog(props: ProfileTarget & { onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const found = useApp(props.appId)
  const [profileId, setProfileId] = useState(props.profileId)
  const [edit, setEdit] = useState(() => Boolean(props.edit))
  const [from, setFrom] = useState(props.from)
  const [mode, setMode] = useState<Mode>(() => (props.newAccount ? "fresh" : "resolve"))
  const [waiting, setWaiting] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [section, setSection] = useState<"edit" | "connection">("edit")
  const [motion, setMotion] = useState<keyof typeof slides>("none")
  const signIn = useSignIn(() => setWaiting(true))
  const profile = useQuery({
    ...api["app-profile"].get.queryOptions({ idOrSlug: profileId ?? "" }),
    enabled: Boolean(profileId),
    refetchOnWindowFocus: "always",
    refetchInterval: waiting ? 2000 : false,
  })
  if (!found.app && !found.pending) return null
  const step = stepOf({
    profileId,
    existing: Boolean(props.existing),
    edit,
    section,
    from,
    chooseSpace: Boolean(props.chooseSpace),
  })
  const adding = from !== undefined && !props.profileId && !props.existing
  const move = (direction: "in" | "back", change: () => void) => {
    setMotion(direction)
    setReplacing(false)
    change()
  }
  const go = (next: "edit" | "connection") => move(next === "edit" ? "back" : "in", () => setSection(next))
  const toMode = (next: Mode, direction: "in" | "back") =>
    move(direction, () => {
      setProfileId(undefined)
      setEdit(false)
      setSection("edit")
      setWaiting(false)
      setMode(next)
    })
  const begin = (next: AppProfile, tab?: Window | null) => {
    const only = next.items.length === 1 ? next.items.at(0) : undefined
    if (gaps(next).length === 0) {
      tab?.close()
      toMode("resolve", "in")
      return
    }
    move("in", () => {
      setProfileId(next.id)
      setEdit(false)
      setSection("edit")
    })
    if (only && signsIn(only) && only.status !== "ok" && next.oauthApps.every((gate) => gate.isConfigured))
      signIn.start(next.id, only, tab)
    else tab?.close()
  }
  const back = (() => {
    if (step === "connection") return () => go("edit")
    if ((step === "connect" || step === "edit") && adding) return () => toMode("resolve", "back")
    if (step === "add" && mode !== "resolve" && !props.newAccount) return () => toMode("resolve", "back")
    if (step === "add" && props.chooseSpace) return () => move("back", () => setFrom(props.from))
    return null
  })()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent // ast-grep-ignore: require-overlay-title -- each step renders its DialogTitle through Screen
        showCloseButton={false}
        className="flex h-[calc(100dvh-(--spacing(8)))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        {back ? (
          <Button variant="ghost" size="sm" className="absolute top-3 left-3 z-10 text-muted-foreground" onClick={back}>
            <IconChevronLeft data-icon="inline-start" />
            Back
          </Button>
        ) : null}
        <div key={[step, mode, from?.spaceId].join("-")} className={cn("flex min-h-0 flex-1 flex-col", slides[motion])}>
          <ProfileStep
            app={found.app}
            profile={profile.data}
            step={step}
            from={from}
            mode={mode}
            replacing={replacing}
            waiting={waiting}
            onBegin={begin}
            onMode={(next) => toMode(next, "in")}
            onSpace={(space) => move("in", () => setFrom(space))}
            onOpen={(id) =>
              move("in", () => {
                setProfileId(id)
                setEdit(true)
                setSection("edit")
              })
            }
            onCreated={(created) => move("in", () => setProfileId(created.id))}
            onConnection={() => go("connection")}
            onClose={props.onClose}
            onDone={edit ? () => go("edit") : props.onClose}
            onSaved={adding ? () => toMode("resolve", "back") : props.onClose}
            onReplace={() => setReplacing(true)}
            onReplaced={() => setReplacing(false)}
            onWaiting={() => setWaiting(true)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

type StepProps = {
  app: App
  profile: AppProfile | undefined
  step: ReturnType<typeof stepOf>
  from: From | undefined
  mode: Mode
  replacing: boolean
  waiting: boolean
  onBegin: (profile: AppProfile, tab?: Window | null) => void
  onMode: (mode: Mode) => void
  onSpace: (space: From) => void
  onOpen: (profileId: string) => void
  onCreated: (profile: AppProfile) => void
  onConnection: () => void
  onClose: () => void
  onDone: () => void
  onSaved: () => void
  onReplace: () => void
  onReplaced: () => void
  onWaiting: () => void
}

function ProfileStep(props: Omit<StepProps, "app"> & { app: App | undefined }) {
  const app = props.app
  const from = props.from
  if (!app)
    return (
      <Screen app={{ name: "", icon: null }} title="Loading app" description="" action={null}>
        <SkeletonRows count={2} label="Loading app" />
      </Screen>
    )
  if (props.step === "existing" && from) return <ExistingStep app={app} from={from} onDone={props.onClose} />
  if (props.step === "spaces") return <SpacesStep app={app} onPick={props.onSpace} onClose={props.onClose} />
  if (props.step === "create") return <CreateStep app={app} onCreated={props.onCreated} />
  if (props.step === "add" && from)
    return (
      <AddStep
        app={app}
        from={from}
        mode={props.mode}
        known={undefined}
        onBegin={props.onBegin}
        onMode={props.onMode}
        onOpen={props.onOpen}
        onClose={props.onClose}
      />
    )
  return <AccountStep {...props} app={app} />
}

function AccountStep(props: StepProps) {
  const app = props.app
  const profile = props.profile
  if (props.step === "edit" && profile)
    return (
      <EditStep
        app={app}
        profile={profile}
        from={props.from}
        onConnection={props.onConnection}
        onDone={props.onSaved}
      />
    )
  if (!profile)
    return (
      <Screen app={app} title={app.name} description={app.description} action={null}>
        <SkeletonRows count={2} label="Loading account" />
      </Screen>
    )
  const connected = profile.items.every((item) => item.optional || item.status === "ok") && !props.replacing
  if (connected && props.from && props.step === "connect")
    return (
      <AddStep
        app={app}
        from={props.from}
        mode="resolve"
        known={profile}
        onBegin={props.onBegin}
        onMode={props.onMode}
        onOpen={props.onOpen}
        onClose={props.onClose}
      />
    )
  if (connected)
    return (
      <Connected
        app={app}
        profile={profile}
        onReplace={props.onReplace}
        onWaiting={props.onWaiting}
        onDone={props.onDone}
      />
    )
  return (
    <ConnectStep
      app={app}
      profile={profile}
      waiting={props.waiting}
      onSaved={props.onReplaced}
      onWaiting={props.onWaiting}
      onDone={props.onDone}
    />
  )
}

function StatusLine(props: { status: Status; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot status={props.status} />
      {props.children}
    </span>
  )
}

type Target = From & { slug: string; private: boolean }

type StateProps = {
  app: App
  from: Target
  title: string
  status: Status
  here: ReadonlyArray<AppProfile>
  onBegin: (profile: AppProfile, tab?: Window | null) => void
  onMode: (mode: Mode) => void
  onOpen: (profileId: string) => void
  onClose: () => void
}

const primary = "h-10 w-full"
const secondary = "h-10 w-full text-muted-foreground"

const targetOf = (from: From, space: SpaceInfo | undefined): Target => ({
  ...from,
  slug: space?.slug ?? from.spaceId,
  members: space?.memberCount ?? from.members,
  private: space?.kind === "private",
})

function AddStep(props: {
  app: App
  from: From
  mode: Mode
  known: AppProfile | undefined
  onBegin: (profile: AppProfile, tab?: Window | null) => void
  onMode: (mode: Mode) => void
  onOpen: (profileId: string) => void
  onClose: () => void
}) {
  const me = useMe().user.id
  const space = useSpaces().space(props.from.spaceId)
  const listed = useAppProfiles([props.app.id])
  const app = props.app
  const known = props.known
  const from = targetOf(props.from, space)
  const others = listed.of(app.id).filter((each) => each.id !== known?.id)
  const profiles = known ? [...others, known] : others
  const reaches = (profile: AppProfile) =>
    profile.kind === "private" ? from.private && profile.userId === me : listsSpace(profile, from.spaceId)
  const usable = (profile: AppProfile) =>
    profile.kind === "private"
      ? profile.userId === me && !from.private
      : profile.canAdd.includes(from.private ? "ownPrivate" : "joined")
  const here = profiles.filter(reaches)
  const expired = here.find((profile) => profile.items.some((item) => item.status === "reconnect"))
  const elsewhere = profiles.filter((profile) => !expired && !reaches(profile) && gaps(profile).length === 0)
  const options = elsewhere.filter(usable)
  const locked = elsewhere.find((profile) => !usable(profile))
  const credits = here.find((profile) => statusOf(app, [profile]) === "credits")
  const state: StateProps = {
    app,
    from,
    title: here.length > 0 ? `${app.name} in ${from.name}` : `Add ${app.name} to ${from.name}`,
    status: statusOf(app, here),
    here,
    onBegin: props.onBegin,
    onMode: props.onMode,
    onOpen: props.onOpen,
    onClose: props.onClose,
  }
  const spare = [expired, ...here].find((profile) => profile !== undefined && gaps(profile).length > 0)
  if (listed.pending)
    return (
      <Screen app={app} title={state.title} description="Loading accounts" action={null}>
        <SkeletonRows count={2} label="Loading accounts" />
      </Screen>
    )
  if (props.mode === "fresh")
    return (
      <NewStep
        {...state}
        title={`Add ${app.name} to ${from.name}`}
        others={profiles}
        reuse={undefined}
        start="connect"
      />
    )
  if (props.mode === "reuse") return <NewStep {...state} others={profiles} reuse={spare} start="connect" />
  if (here.some((profile) => gaps(profile).length === 0)) return <WorkingState {...state} />
  if (options.length > 0) return <ExistingState {...state} options={options} />
  if (credits) return <CreditsState {...state} credits={credits} />
  if (locked) return <LockedState {...state} locked={locked} />
  return (
    <NewStep
      {...state}
      others={profiles}
      reuse={spare}
      start={here.length === 0 && hasManaged(app) ? "add" : "connect"}
    />
  )
}

function SpaceAccounts(props: StateProps) {
  return (
    <div className="w-full text-left">
      <AccountList
        title="Accounts"
        app={props.app}
        profiles={props.here}
        onOpen={(profile) => props.onOpen(profile.id)}
      />
    </div>
  )
}

function WorkingState(props: StateProps) {
  const holder = props.here
    .filter((profile) => gaps(profile).length === 0)
    .flatMap((profile) => profile.items)
    .find((item) => item.holder)?.holder
  return (
    <Screen
      app={props.app}
      title={props.title}
      description={<StatusLine status="connected">{holder ? `Connected as ${holder.name}` : "Connected"}</StatusLine>}
      onSubmit={props.onClose}
      action={
        <>
          <Button type="submit" className={primary}>
            Done
          </Button>
          <Button type="button" variant="ghost" className={secondary} onClick={() => props.onMode("fresh")}>
            Add another account
          </Button>
        </>
      }
    >
      <SpaceAccounts {...props} />
    </Screen>
  )
}

function ExistingState(props: StateProps & { options: ReadonlyArray<AppProfile> }) {
  const [picked, setPicked] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const { api } = RouterContext.useRouterContext()
  const access = useMutation(api["app-profile"].access.mutationOptions())
  const promote = useMutation(api["app-profile"].promote.mutationOptions())
  const from = props.from
  const pending = access.isPending || promote.isPending
  const addHere = (profile: AppProfile) =>
    void (
      profile.kind === "private"
        ? promote.mutateAsync({ id: profile.id, spaceId: from.spaceId })
        : access.mutateAsync({ id: profile.id, add: [from.spaceId] })
    ).then(
      () => toast.success(`${profile.name} is now in ${from.name}`),
      (error: unknown) =>
        toast.error(`Couldn’t use ${profile.name} in ${from.name}`, { description: errorMessage(error) }),
    )
  const choice = props.options.find((profile) => profile.id === picked) ?? props.options.at(0)
  if (!choice) return null
  const button = (
    <Button type="submit" className={primary} disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Use in {from.name}
    </Button>
  )
  if (confirming)
    return (
      <Screen
        app={props.app}
        title={`Use ${choice.name} in ${from.name}?`}
        description={`Everyone in ${from.name} (${plural(from.members, "person", "people")}) can then use it. ${staysIn(choice)}`}
        onSubmit={() => addHere(choice)}
        action={
          <>
            {button}
            <Button type="button" variant="ghost" className={secondary} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        }
      />
    )
  return (
    <Screen
      app={props.app}
      title={props.title}
      description={<StatusLine status={props.status}>{statusLabel[props.status]}</StatusLine>}
      onSubmit={() => {
        if (!from.private && from.members > 1) setConfirming(true)
        else addHere(choice)
      }}
      action={
        <>
          {button}
          <Button type="button" variant="ghost" className={secondary} onClick={() => props.onMode("reuse")}>
            Connect new
          </Button>
        </>
      }
    >
      <FieldSet className="w-full text-left">
        <FieldLegend variant="label">You can use an existing {props.app.name} account</FieldLegend>
        <RadioGroup
          value={choice.id}
          onValueChange={(value) => {
            if (typeof value === "string") setPicked(value)
          }}
          className="gap-0 divide-y overflow-hidden rounded-lg border bg-card"
        >
          {props.options.map((profile) => (
            <FieldLabel
              key={profile.id}
              htmlFor={`use-${profile.id}`}
              className="flex min-h-14 w-full items-center gap-3 px-3 py-2 font-normal"
            >
              <RadioGroupItem id={`use-${profile.id}`} value={profile.id} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm">{profile.name}</span>
                <span className="flex flex-wrap gap-1">
                  <SpacePills profile={profile} />
                </span>
              </span>
            </FieldLabel>
          ))}
        </RadioGroup>
      </FieldSet>
    </Screen>
  )
}

function staysIn(profile: AppProfile) {
  if (profile.kind === "private") return "It stops being only yours."
  const spaces = reachedSpaces(profile)
  return spaces.length > 0 ? `It stays in ${spaces.join(", ")}.` : ""
}

function CreditsState(props: StateProps & { credits: AppProfile }) {
  return (
    <Screen
      app={props.app}
      title={props.title}
      description={<StatusLine status="credits">Works on Ren credits</StatusLine>}
      onSubmit={props.onClose}
      action={
        <>
          <Button type="submit" className={primary}>
            Done
          </Button>
          <Button type="button" variant="ghost" className={secondary} onClick={() => props.onBegin(props.credits)}>
            Connect my own
          </Button>
        </>
      }
    >
      <p className="text-sm text-balance text-muted-foreground">
        Connect your own {props.app.name} account to use your plan in place of Ren credits.
      </p>
      <SpaceAccounts {...props} />
    </Screen>
  )
}

function askWho(profile: AppProfile, owner: string | undefined) {
  if (!owner) return "an admin"
  return profile.kind === "private" ? owner : `${owner} or an admin`
}

function LockedState(props: StateProps & { locked: AppProfile }) {
  const platform = Platform.usePlatform()
  const locked = props.locked
  const from = props.from
  const owner = useMembers().member(locked.kind === "private" ? locked.userId : locked.createdBy)?.name
  const who = askWho(locked, owner)
  const write = platform.writeClipboardText
  const where = locked.kind === "private" ? "private" : `in ${reachedSpaces(locked).join(", ") || "no space"}`
  const link = `${platform.appUrl}/apps/${props.app.slug}?${new URLSearchParams({ account: locked.slug, space: from.slug }).toString()}`
  return (
    <Screen
      app={props.app}
      title={props.title}
      description={<StatusLine status={props.status}>{statusLabel[props.status]}</StatusLine>}
      onSubmit={() => props.onMode("reuse")}
      action={
        <Button type="submit" className={primary}>
          Connect my own
        </Button>
      }
    >
      <div className="flex w-full flex-col gap-6">
        <p className="text-sm text-balance">
          {owner ? `${owner}’s` : "An"} account “{locked.name}” is {where}. Only {who} can add it to {from.name}.
        </p>
        {write ? (
          <Button
            type="button"
            variant="outline"
            className={primary}
            onClick={() =>
              void write(
                `Can you add your ${props.app.name} account “${locked.name}” to ${from.name} in Ren?\n${link}`,
              ).then(
                () => toast.success("Share link copied", { description: `Send it to ${who}.` }),
                (error: unknown) => toast.error("Couldn’t copy the link", { description: errorMessage(error) }),
              )
            }
          >
            <IconCopy data-icon="inline-start" />
            Copy share link
          </Button>
        ) : null}
        <FieldSeparator>or</FieldSeparator>
      </div>
    </Screen>
  )
}

const signsInFirst = (app: App, reuse: AppProfile | undefined) => {
  if (reuse) return reuse.items.length === 1 && reuse.items.some(signsIn)
  return Object.values(app.mcps ?? {}).some(
    (mcp) => mcp.transport.type !== "managed" && (mcp.auth.type === "oauth" || mcp.transport.type === "provider"),
  )
}

function NewStep(
  props: StateProps & {
    reuse: AppProfile | undefined
    others: ReadonlyArray<AppProfile>
    start: "add" | "connect"
  },
) {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const user = useMe().user.name
  const create = useMutation(api["app-profile"].create.mutationOptions())
  const update = useMutation(api["app-profile"].update.mutationOptions())
  const [name, setName] = useState<string>()
  const app = props.app
  const from = props.from
  const reuse = props.reuse
  const accountName =
    name ??
    reuse?.name ??
    defaultName({ from, only: from.private, picked: new Set(), spaces: [], others: props.others, app, user })
  const status = statusOf(
    app,
    props.here.filter((profile) => profile.id === reuse?.id),
  )
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error
  const opensSignIn = props.start === "connect" && signsInFirst(app, reuse)
  const popup = () => platform.blankPopup?.() ?? platform.blankTab?.() ?? null
  const submit = () => {
    const trimmed = accountName.trim()
    if (!trimmed || pending) return
    if (reuse?.name === trimmed) return props.onBegin(reuse)
    const tab = opensSignIn ? popup() : null
    const after = {
      onSuccess: (profile: AppProfile) => {
        if (props.start === "connect") props.onBegin(profile, tab)
      },
      onError: () => tab?.close(),
    }
    if (reuse) return update.mutate({ id: reuse.id, name: trimmed }, after)
    create.mutate(
      {
        appId: app.id,
        name: trimmed,
        slug: freeSlug(trimmed, new Set(props.others.map((each) => each.slug))),
        kind: from.private ? "private" : "shared",
        ...(!from.private && { spaceIds: [from.spaceId] }),
      },
      after,
    )
  }
  return (
    <Screen
      app={app}
      title={props.title}
      description={<StatusLine status={status}>{statusLabel[status]}</StatusLine>}
      onSubmit={submit}
      action={
        <>
          {error ? <FieldError className="text-center">{errorMessage(error)}</FieldError> : null}
          <Button type="submit" className={primary} disabled={pending || !accountName.trim()}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {props.start === "add" ? `Add to ${from.name}` : "Connect"}
          </Button>
          <Button type="button" variant="ghost" className={secondary} onClick={props.onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <Field className="w-full text-left">
        <FieldLabel htmlFor="profile-name">Account name</FieldLabel>
        <Input id="profile-name" required value={accountName} onChange={(event) => setName(event.target.value)} />
        <FieldDescription>
          {from.private ? "Only you can use this account." : `Everyone in ${from.name} can use this account.`}
        </FieldDescription>
      </Field>
    </Screen>
  )
}

function SpacesStep(props: { app: App; onPick: (space: From) => void; onClose: () => void }) {
  const navigate = useNavigate()
  const me = useMe().user.id
  const joined = useSpaces().joined
  const profiles = useAppProfiles([props.app.id])
  const app = props.app
  const added = (space: (typeof joined)[number]) =>
    profiles
      .of(app.id)
      .some((profile) =>
        profile.kind === "private" ? space.kind === "private" && profile.userId === me : listsSpace(profile, space.id),
      )
  return (
    <Screen
      app={app}
      title={`Add ${app.name} to a space`}
      description={`Pick a space. Everyone in it can use ${app.name}.`}
      action={null}
    >
      {profiles.pending ? (
        <SkeletonRows count={3} label="Loading spaces" />
      ) : (
        <div className="flex w-full flex-col divide-y overflow-hidden rounded-lg border bg-card text-left">
          {joined.map((space) => {
            const isAdded = added(space)
            return (
              <Button
                key={space.id}
                type="button"
                variant="ghost"
                className="group/row h-12 shrink-0 justify-start gap-3 rounded-none px-3 font-normal active:not-aria-[haspopup]:scale-100"
                onClick={() => {
                  if (!isAdded)
                    return props.onPick({
                      spaceId: space.id,
                      name: space.name,
                      members: space.memberCount,
                      private: space.kind === "private",
                    })
                  props.onClose()
                  void navigate({ to: "/spaces/$spaceId/apps", params: { spaceId: space.id }, search: { app: app.id } })
                }}
              >
                {space.kind === "private" ? (
                  <IconLock className="text-muted-foreground" />
                ) : (
                  <IconCube className="text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-left">{space.name}</span>
                {isAdded ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <IconCheck className="text-chart-2" />
                    Added
                  </span>
                ) : null}
                <IconChevronRight className="text-muted-foreground transition-transform duration-150 ease-out group-hover/row:translate-x-0.5" />
              </Button>
            )
          })}
        </div>
      )}
    </Screen>
  )
}

function Screen(props: {
  app: Pick<App, "name" | "icon">
  title: string
  description?: ReactNode
  children?: ReactNode
  action: ReactNode
  menu?: ReactNode
  note?: ReactNode
  onSubmit?: () => void
}) {
  return (
    <form
      className="relative flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit?.()
      }}
    >
      {props.menu}
      <Empty className="min-h-0 justify-start gap-8 overflow-y-auto overscroll-contain px-10 pt-14 pb-6">
        <EmptyHeader className="max-w-xs gap-3">
          <EmptyMedia className="mb-3">
            <AppIcon
              name={props.app.name}
              icon={props.app.icon}
              className="size-20 rounded-[--spacing(5.5)] text-3xl shadow-sm ring-1 ring-foreground/10"
            />
          </EmptyMedia>
          <DialogTitle className="text-2xl/8 font-semibold tracking-heading">{props.title}</DialogTitle>
          {props.description ? (
            <DialogDescription className="text-balance">{props.description}</DialogDescription>
          ) : null}
        </EmptyHeader>
        {props.children ? <EmptyContent className="max-w-sm gap-4">{props.children}</EmptyContent> : null}
      </Empty>
      {props.action || props.note ? (
        <div className="flex shrink-0 flex-col gap-3 px-10 pt-2 pb-8">
          {props.action}
          {props.note ? <p className="text-center text-xs text-muted-foreground">{props.note}</p> : null}
        </div>
      ) : null}
    </form>
  )
}

function SpacesField(props: {
  spaces: ReadonlyArray<{ id: string; name: string }>
  picked: ReadonlySet<string>
  only: boolean
  onPick: (picked: ReadonlySet<string>) => void
  onOnly?: ((only: boolean) => void) | undefined
  every?: { checked: boolean; onChange: (checked: boolean) => void } | undefined
}) {
  const row = "flex h-11 shrink-0 items-center justify-between gap-3 px-3"
  const [listRef, edges] = useScrollEdges({ axis: "y" })
  const [query, setQuery] = useState("")
  const every = props.every
  const onOnly = props.onOnly
  const shown = props.spaces.filter((space) => Search.matches(query, space.name))
  return (
    <Field className="text-left">
      <FieldLabel>Spaces</FieldLabel>
      <div className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
        {props.spaces.length > 5 ? (
          <InputGroup className="h-11 rounded-none border-0 bg-transparent shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-transparent">
            <InputGroupAddon>
              <IconSearch />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search spaces"
              placeholder="Design"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
        ) : null}
        {every ? (
          <div className={row}>
            <FieldLabel htmlFor="profile-every" className="flex-1 font-normal">
              <IconBuilding className="size-4 shrink-0 text-muted-foreground" />
              Every space
            </FieldLabel>
            <Switch id="profile-every" checked={every.checked} onCheckedChange={(checked) => every.onChange(checked)} />
          </div>
        ) : null}
        <div
          ref={listRef}
          className={cn(
            "flex max-h-38.5 scrollbar-thin flex-col divide-y overflow-y-auto overscroll-contain",
            edges.start && edges.end && "mask-y-from-65%",
            edges.start && !edges.end && "mask-t-from-65%",
            !edges.start && edges.end && "mask-b-from-65%",
          )}
        >
          {shown.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No spaces match “{query}”</p> : null}
          {shown.map((space) => (
            <div key={space.id} className={row}>
              <FieldLabel htmlFor={`profile-space-${space.id}`} className="min-w-0 flex-1 font-normal">
                <IconCube className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{space.name}</span>
              </FieldLabel>
              <Switch
                id={`profile-space-${space.id}`}
                disabled={every?.checked}
                checked={Boolean(every?.checked) || (!props.only && props.picked.has(space.id))}
                onCheckedChange={(checked) => {
                  const next = new Set(props.only ? [] : props.picked)
                  if (checked) next.add(space.id)
                  else next.delete(space.id)
                  props.onPick(next)
                }}
              />
            </div>
          ))}
        </div>
        {onOnly ? (
          <div className={row}>
            <FieldLabel htmlFor="profile-only" className="flex-1 font-normal">
              <IconLock className="size-4 shrink-0 text-muted-foreground" />
              Only me
            </FieldLabel>
            <Switch id="profile-only" checked={props.only} onCheckedChange={(checked) => onOnly(checked)} />
          </div>
        ) : null}
      </div>
    </Field>
  )
}

function connectionLabel(profile: AppProfile) {
  if (gaps(profile).length > 0) return "Not connected"
  const holder = profile.items.find((item) => item.holder)?.holder
  return holder ? `Connected as ${holder.name}` : "Connected"
}

function useEditProfile(profile: AppProfile, onDone: () => void) {
  const { api } = RouterContext.useRouterContext()
  const update = useMutation({ ...api["app-profile"].update.mutationOptions() })
  const access = useMutation({ ...api["app-profile"].access.mutationOptions() })
  const listed = new Set(profile.spaces.map((space) => space.id))
  const [name, setName] = useState(profile.name)
  const [picked, setPicked] = useState<ReadonlySet<string>>(listed)
  const [every, setEvery] = useState(profile.allSpaces)
  const shared = profile.kind === "shared" && profile.canAccess
  const add = [...picked].filter((id) => !listed.has(id))
  const remove = [...listed].filter((id) => !picked.has(id))
  const renamed = name.trim() !== profile.name && name.trim().length > 0
  const moved = shared && (add.length > 0 || remove.length > 0 || every !== profile.allSpaces)
  const pending = update.isPending || access.isPending
  const submit = () => {
    if (!renamed && !moved) return onDone()
    const saveSpaces = () =>
      moved
        ? access.mutate(
            {
              id: profile.id,
              ...(add.length > 0 && { add }),
              ...(remove.length > 0 && { remove }),
              ...(every !== profile.allSpaces && { allSpaces: every }),
            },
            { onSuccess: onDone },
          )
        : onDone()
    if (renamed) update.mutate({ id: profile.id, name: name.trim() }, { onSuccess: saveSpaces })
    else saveSpaces()
  }
  return {
    name,
    setName,
    picked,
    setPicked,
    every,
    setEvery,
    shared,
    pending,
    blocked: pending || (shared && !every && picked.size === 0),
    error: update.error ?? access.error,
    submit,
  }
}

function EditStep(props: {
  app: App
  profile: AppProfile
  from: From | undefined
  onConnection: () => void
  onDone: () => void
}) {
  const profile = props.profile
  const spaces = useSpaces().joined.filter((space) => space.kind !== "private")
  const edit = useEditProfile(profile, props.onDone)
  return (
    <Screen
      app={props.app}
      title={`Edit ${props.app.name} account`}
      onSubmit={edit.submit}
      action={
        <>
          {edit.error ? <FieldError className="text-center">{errorMessage(edit.error)}</FieldError> : null}
          <Button type="submit" className="h-10 w-full" disabled={edit.blocked}>
            {edit.pending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
        </>
      }
      menu={
        props.from ? (
          <RemoveFromSpace profile={profile} from={props.from} onRemoved={props.onDone} />
        ) : (
          <AccountMenu profile={profile} onDeleted={props.onDone} />
        )
      }
    >
      <FieldGroup className="w-full gap-6">
        {profile.items.length > 0 ? <ConnectionField profile={profile} onConnection={props.onConnection} /> : null}
        <Field className="text-left">
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <Input id="profile-name" required value={edit.name} onChange={(event) => edit.setName(event.target.value)} />
        </Field>
        {edit.shared ? (
          <SpacesField
            spaces={spaces}
            picked={edit.picked}
            only={false}
            onPick={edit.setPicked}
            {...(profile.canShareEverySpace && { every: { checked: edit.every, onChange: edit.setEvery } })}
          />
        ) : null}
        <DependenciesField profile={profile} />
      </FieldGroup>
    </Screen>
  )
}

function MenuTrigger(props: { profile: AppProfile }) {
  return (
    <DropdownMenuTrigger
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`More for ${props.profile.name}`}
          className="absolute top-3 right-3 z-10 text-muted-foreground"
        />
      }
    >
      <IconDots />
    </DropdownMenuTrigger>
  )
}

function RemoveFromSpace(props: { profile: AppProfile; from: From; onRemoved: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const access = useMutation(api["app-profile"].access.mutationOptions())
  const [confirming, setConfirming] = useState(false)
  const profile = props.profile
  const from = props.from
  const others = reachedSpaces(profile).filter((name) => name !== from.name)
  if (
    profile.kind === "private" ||
    profile.allSpaces ||
    !profile.spaces.some((space) => space.id === from.spaceId) ||
    !profile.canRemove.some((shape) => shape === "joined" || shape === "shared")
  )
    return null
  return (
    <>
      <DropdownMenu>
        <MenuTrigger profile={profile} />
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
              <IconTrash />
              Remove from {from.name}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        confirmation={{
          title: `Remove ${profile.name} from ${from.name}?`,
          description: `${from.name} stops using it. ${others.length > 0 ? `It stays in ${others.join(", ")}.` : lastSpaceWarning(profile)}`,
          action: "Remove",
        }}
        onConfirm={() =>
          access.mutateAsync(
            { id: profile.id, remove: [from.spaceId] },
            {
              onSuccess: (info) => {
                toastRemoved(info, from.name, {
                  onUndo: () => access.mutateAsync({ id: profile.id, add: [from.spaceId] }),
                })
                props.onRemoved()
              },
              onError: (error) =>
                toast.error(`Couldn’t remove ${profile.name} from ${from.name}`, { description: errorMessage(error) }),
            },
          )
        }
      />
    </>
  )
}

function AccountMenu(props: { profile: AppProfile; onDeleted: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const remove = useMutation(api["app-profile-reach"]["app-profile"].delete.mutationOptions())
  const [confirming, setConfirming] = useState(false)
  const profile = props.profile
  const used = reachedSpaces(profile)
  return (
    <>
      <DropdownMenu>
        <MenuTrigger profile={profile} />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
              <IconTrash />
              Delete account
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        confirmation={{
          title: `Delete ${profile.name}?`,
          description: `${used.length > 0 ? `${used.join(", ")} ${used.length === 1 ? "uses" : "use"} it. ` : ""}Ren deletes the account and its sign-ins. Those spaces use Ren credits or show Not connected.`,
          action: "Delete account",
        }}
        onConfirm={() =>
          remove.mutateAsync(
            { id: profile.id },
            {
              onSuccess: () => {
                toast.success(`${profile.name} deleted`)
                props.onDeleted()
              },
              onError: (error) => toast.error("Couldn’t delete the account", { description: errorMessage(error) }),
            },
          )
        }
      />
    </>
  )
}

function DependenciesField(props: { profile: AppProfile }) {
  const { api } = RouterContext.useRouterContext()
  const profile = props.profile
  const appIds = profile.links.map((each) => each.appId)
  const apps = useApps(appIds)
  const profiles = useAppProfiles(appIds)
  const link = useMutation(api["app-profile"].link.mutationOptions())
  if (profile.links.length === 0) return null
  return (
    <Field className="text-left">
      <FieldLabel>Dependencies</FieldLabel>
      <div className="flex flex-col gap-2">
        {profile.links.map((each) => {
          const app = apps.of(each.appId)
          const name = app?.name ?? "App"
          const options = profiles
            .of(each.appId)
            .filter(
              (option) => option.kind === "shared" || (profile.kind === "private" && option.userId === profile.userId),
            )
            .map((option) => ({ value: option.id, label: option.name }))
          return (
            <div key={each.appId} className="flex items-center gap-3">
              <AppIcon name={name} icon={app?.icon} size="sm" className="size-6 rounded-md text-xs" />
              <span className="flex-1 truncate text-base font-medium">{name}</span>
              <Select
                items={options}
                value={each.profileId}
                onValueChange={(profileId) => {
                  if (typeof profileId !== "string") return
                  void link
                    .mutateAsync({ id: profile.id, appId: each.appId, profileId })
                    .catch((error: unknown) =>
                      toast.error(`Couldn’t link ${name}`, { description: errorMessage(error) }),
                    )
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={`${name} account to use`}
                  className="gap-1 px-2 text-xs data-[size=sm]:h-6.5"
                >
                  <SelectValue placeholder="Choose account" />
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
            </div>
          )
        })}
      </div>
    </Field>
  )
}

function ConnectionField(props: { profile: AppProfile; onConnection: () => void }) {
  const missing = gaps(props.profile).length > 0
  return (
    <Field className="text-left">
      <FieldLabel>Connection</FieldLabel>
      <Button
        variant="ghost"
        onClick={props.onConnection}
        className="group/row flex h-11 justify-start gap-3 border-border bg-card px-3 text-left font-normal hover:bg-muted/60 hover:text-inherit focus-visible:border-border active:not-aria-[haspopup]:scale-100"
      >
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", missing ? "bg-chart-3" : "bg-chart-2")} />
        <span className="flex-1 truncate">{connectionLabel(props.profile)}</span>
        <span className="text-xs text-muted-foreground">{missing ? "Connect" : "Manage"}</span>
        <IconChevronRight className="text-muted-foreground transition-transform duration-150 ease-out group-hover/row:translate-x-0.5" />
      </Button>
    </Field>
  )
}

function ExistingStep(props: { app: App; from: From; onDone: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const me = useMe().user.id
  const profiles = useAppProfiles([props.app.id])
  const access = useMutation(api["app-profile"].access.mutationOptions())
  const promote = useMutation(api["app-profile"].promote.mutationOptions())
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set())
  const [adding, setAdding] = useState<string>()
  const from = props.from
  const reaches = (profile: AppProfile) =>
    profile.allSpaces ||
    profile.spaces.some((space) => space.id === from.spaceId) ||
    (profile.kind === "private" && from.private === true && profile.userId === me)
  const canAdd = (profile: AppProfile) =>
    profile.kind === "private"
      ? profile.userId === me && !from.private
      : profile.canAdd.includes(from.private ? "ownPrivate" : "joined")
  const candidates = profiles.of(props.app.id).filter((profile) => added.has(profile.id) || !reaches(profile))
  const add = (profile: AppProfile) => {
    setAdding(profile.id)
    void (
      profile.kind === "private"
        ? promote.mutateAsync({ id: profile.id, spaceId: from.spaceId })
        : access.mutateAsync({ id: profile.id, add: [from.spaceId] })
    )
      .then(
        () => setAdded((previous) => new Set([...previous, profile.id])),
        (error: unknown) => toast.error(`Couldn’t add ${profile.name}`, { description: errorMessage(error) }),
      )
      .finally(() => setAdding(undefined))
  }
  return (
    <Screen
      app={props.app}
      title={`Use an existing ${props.app.name} account`}
      description={
        from.private
          ? "Only you can use the accounts you add here."
          : `Everyone in ${from.name} can use the accounts you add.`
      }
      onSubmit={props.onDone}
      action={
        <Button type="submit" className="h-10 w-full">
          Done
        </Button>
      }
    >
      {profiles.pending ? <SkeletonRows count={2} label="Loading accounts" /> : null}
      {!profiles.pending && candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other {props.app.name} accounts in your organization.</p>
      ) : null}
      {!profiles.pending && candidates.length > 0 ? (
        <div className="flex w-full flex-col divide-y overflow-hidden rounded-lg border bg-card text-left">
          {candidates.map((profile) => (
            <div key={profile.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm">{profile.name}</span>
                {canAdd(profile) ? (
                  <span className="flex flex-wrap gap-1">
                    <SpacePills profile={profile} />
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Only its owner or an admin can add it</span>
                )}
              </div>
              {added.has(profile.id) ? (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <IconCheck className="size-4 text-chart-2" />
                  Added
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canAdd(profile) || adding !== undefined}
                  onClick={() => add(profile)}
                >
                  {adding === profile.id ? <Spinner data-icon="inline-start" /> : null}
                  Add
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </Screen>
  )
}

function CreateStep(props: { app: App; onCreated: (profile: AppProfile) => void }) {
  const { api } = RouterContext.useRouterContext()
  const others = useAppProfiles([props.app.id]).of(props.app.id)
  const user = useMe().user.name
  const spaces = useSpaces().joined.filter((space) => space.kind !== "private")
  const create = useMutation({ ...api["app-profile"].create.mutationOptions() })
  const [name, setName] = useState<string>()
  const [only, setOnly] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(spaces.slice(0, 1).map((space) => space.id)))
  const blocked = !only && picked.size === 0
  const accountName = name ?? defaultName({ from: undefined, only, picked, spaces, others, app: props.app, user })
  return (
    <Screen
      app={props.app}
      title={`New ${props.app.name} account`}
      description="You’ll connect it next."
      onSubmit={() => {
        if (blocked || !accountName.trim()) return
        create.mutate(
          {
            appId: props.app.id,
            name: accountName.trim(),
            slug: freeSlug(accountName, new Set(others.map((each) => each.slug))),
            kind: only ? "private" : "shared",
            ...(!only && { spaceIds: [...picked] }),
          },
          { onSuccess: props.onCreated },
        )
      }}
      action={
        <>
          {create.error ? <FieldError className="text-center">{errorMessage(create.error)}</FieldError> : null}
          <Button type="submit" className="h-10 w-full" disabled={create.isPending || blocked || !accountName.trim()}>
            {create.isPending ? <Spinner data-icon="inline-start" /> : null}
            Create account
          </Button>
        </>
      }
    >
      <FieldGroup className="w-full gap-6">
        <Field className="text-left">
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <Input id="profile-name" value={accountName} onChange={(event) => setName(event.target.value)} />
        </Field>
        <SpacesField
          spaces={spaces}
          picked={picked}
          only={only}
          onPick={(next) => {
            setOnly(false)
            setPicked(next)
          }}
          onOnly={setOnly}
        />
      </FieldGroup>
    </Screen>
  )
}

function ConnectStep(props: {
  app: App
  profile: AppProfile
  waiting: boolean
  onSaved: () => void
  onWaiting: () => void
  onDone: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const profile = props.profile
  const saveKey = useMutation({ ...api.credential.create.mutationOptions() })
  const signIn = useSignIn(props.onWaiting)
  const [key, setKey] = useState("")
  const oauthItem = profile.items.find(signsIn)
  const keyItem = profile.items.find((item) => !signsIn(item))
  const status = statusOf(props.app, [profile])
  const screen = {
    app: props.app,
    title: props.app.name,
    description: <StatusLine status={status}>{statusLabel[status]}</StatusLine>,
  }
  const required = profile.items.filter((item) => !item.optional)
  const done = required.filter((item) => item.status === "ok").length
  if (profile.items.length > 1)
    return (
      <Screen
        {...screen}
        description={
          <StatusLine status={status}>
            {done} of {required.length} done
          </StatusLine>
        }
        onSubmit={props.onDone}
        action={
          <Button type="submit" className="h-10 w-full" disabled={done < required.length}>
            Done
          </Button>
        }
      >
        <ItemRows app={props.app} profile={profile} waiting={props.waiting} onWaiting={props.onWaiting} />
      </Screen>
    )
  if (props.waiting && oauthItem && oauthItem.status !== "ok")
    return (
      <Screen
        {...screen}
        description={`Sign in in the ${props.app.name} window, then come back here.`}
        onSubmit={() => signIn.start(profile.id, oauthItem)}
        action={
          <Button type="submit" variant="ghost" className="h-10 w-full text-muted-foreground">
            Open {props.app.name} again
          </Button>
        }
      >
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Waiting for {props.app.name}…
        </span>
      </Screen>
    )
  const submit = () => {
    if (oauthItem) return signIn.start(profile.id, oauthItem)
    const value = key.trim()
    if (!keyItem || !value) return
    const field = keyTarget(keyItem, props.app).field
    saveKey.mutate(
      {
        payload: {
          owner: { kind: "profile", profileId: profile.id },
          item: keyItem.item,
          hosts: Credential.splitHosts(keyTarget(keyItem, props.app).host),
          value: field ? { type: "fields", fields: { [field]: value } } : { type: "key", value },
        },
      },
      { onSuccess: props.onSaved },
    )
  }
  const pending = signIn.pending || saveKey.isPending
  return (
    <Screen
      {...screen}
      onSubmit={submit}
      note={oauthItem ? `You’ll sign in to ${props.app.name} in a small window, then come back here.` : undefined}
      action={
        <>
          {saveKey.error ? <FieldError className="text-center">{errorMessage(saveKey.error)}</FieldError> : null}
          <Button type="submit" className="h-10 w-full" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Connect
          </Button>
        </>
      }
    >
      <Gates profile={profile} />
      {keyItem ? (
        <Field className="w-full text-left">
          <FieldLabel htmlFor="profile-key">API key</FieldLabel>
          <Input
            id="profile-key"
            type="password"
            required
            autoComplete="off"
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the key is the only thing this step asks for
            autoFocus
            placeholder="Paste your API key"
            className="h-10 font-mono placeholder:font-sans"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </Field>
      ) : null}
    </Screen>
  )
}

function ItemRows(props: { app: App; profile: AppProfile; waiting: boolean; onWaiting: () => void }) {
  const signIn = useSignIn(props.onWaiting)
  return (
    <div className="flex w-full flex-col gap-3 text-left">
      <Gates profile={props.profile} />
      <Rows>
        {props.profile.items.map((item) =>
          signsIn(item) ? (
            <SignInRow
              key={item.label}
              item={item}
              waiting={props.waiting && item.status !== "ok"}
              onSignIn={() => signIn.start(props.profile.id, item)}
            />
          ) : (
            <KeyRow key={item.label} profileId={props.profile.id} app={props.app} item={item} />
          ),
        )}
      </Rows>
    </div>
  )
}

function Gates(props: { profile: AppProfile }) {
  const write = Platform.usePlatform().writeClipboardText
  const missing = props.profile.oauthApps.filter((gate) => !gate.isConfigured)
  if (missing.length === 0) return null
  return (
    <>
      {missing.map((gate) => (
        <Alert key={gate.name} className="text-left">
          <IconAlertTriangle className="text-chart-3" />
          <AlertDescription className="flex flex-col items-start gap-2">
            “{gate.name}” sign-in is not set up for your organization. Ask an admin to set it up.
            {write ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void write(`Can you set up the “${gate.name}” sign-in for our organization in Ren?`).then(
                    () => toast.success("Message copied"),
                    (error: unknown) => toast.error("Couldn’t copy the message", { description: errorMessage(error) }),
                  )
                }
              >
                <IconCopy data-icon="inline-start" />
                Copy message
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ))}
    </>
  )
}

function Connected(props: {
  app: App
  profile: AppProfile
  onReplace: () => void
  onWaiting: () => void
  onDone: () => void
}) {
  const signIn = useSignIn(props.onWaiting)
  const holder = props.profile.items.find((item) => item.holder)?.holder
  const oauthItem = props.profile.items.find(signsIn)
  const keyed = props.profile.items.some((item) => !signsIn(item))
  return (
    <Screen
      app={props.app}
      title={props.app.name}
      description={props.app.description}
      onSubmit={props.onDone}
      action={
        <Button type="submit" className="h-10 w-full">
          Done
        </Button>
      }
    >
      <div className="flex animate-in flex-col items-center gap-4 duration-200 ease-out fade-in-0 zoom-in-95 motion-reduce:zoom-in-100">
        <span className="flex items-center gap-2 text-sm">
          <span className="flex size-5 items-center justify-center rounded-full bg-chart-2/15 text-chart-2">
            <IconCheck className="size-3.5" />
          </span>
          {holder ? `Connected as ${holder.name}` : "Connected"}
        </span>
        <div className="flex items-center gap-2">
          <AccountAccess profile={props.profile} />
          {oauthItem ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => signIn.start(props.profile.id, oauthItem)}
            >
              Reconnect
            </Button>
          ) : null}
          {!oauthItem && keyed ? (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={props.onReplace}>
              Replace key
            </Button>
          ) : null}
        </div>
      </div>
    </Screen>
  )
}

const signInCaption = (item: AppProfileItem) => {
  if (item.status === "ok") return item.holder ? `Connected as ${item.holder.name}` : "Connected"
  if (item.status === "reconnect") return "Signed out. Sign in again to keep it working."
  if (item.status === "unavailable") return "Not available in this organization."
  return "Not signed in yet"
}

const signInAction = (item: AppProfileItem) => {
  if (item.status === "ok") return "Reconnect"
  return item.status === "reconnect" ? "Sign in again" : "Sign in"
}

function SignInRow(props: { item: AppProfileItem; waiting: boolean; onSignIn: () => void }) {
  if (props.waiting)
    return (
      <Row
        title={props.item.name}
        description={`Waiting for ${props.item.name}…`}
        media={<Spinner className="text-muted-foreground" />}
      >
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={props.onSignIn}>
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
        <Button variant={ok ? "outline" : "default"} size="sm" onClick={props.onSignIn}>
          {signInAction(props.item)}
        </Button>
      )}
    </Row>
  )
}

function keyTarget(item: AppProfileItem, app: App) {
  const mcp = "mcp" in item.item ? app.mcps?.[item.item.mcp] : undefined
  const auth = mcp?.auth
  const transport = mcp?.transport
  return {
    field: auth?.type === "header" && typeof auth.credential === "string" ? auth.credential : undefined,
    host: transport?.type === "remote" ? (URL.parse(transport.url)?.hostname ?? "") : "",
  }
}

function KeyRow(props: { profileId: string; app: App; item: AppProfileItem }) {
  const { api } = RouterContext.useRouterContext()
  const [replacing, setReplacing] = useState(false)
  const [value, setValue] = useState("")
  const [hosts, setHosts] = useState("")
  const create = useMutation({ ...api.credential.create.mutationOptions() })
  const target = keyTarget(props.item, props.app)
  if (props.item.status === "ok" && !replacing)
    return (
      <Row title="API key" description="Saved" media={<IconCheck className="size-4 text-chart-2" />}>
        <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
          Replace key
        </Button>
      </Row>
    )
  const id = `key-${props.item.label}`
  const save = () => {
    const list = Credential.splitHosts(target.host || hosts)
    if (!value.trim() || list.length === 0) return
    create.mutate(
      {
        payload: {
          owner: { kind: "profile", profileId: props.profileId },
          item: props.item.item,
          hosts: list,
          value: target.field
            ? { type: "fields", fields: { [target.field]: value.trim() } }
            : { type: "key", value: value.trim() },
        },
      },
      {
        onSuccess: () => {
          setReplacing(false)
          setValue("")
          toast.success("Key saved")
        },
      },
    )
  }
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <Field>
        <FieldLabel htmlFor={id}>API key</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            placeholder="Paste your API key"
            className="font-mono placeholder:font-sans"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              save()
            }}
          />
          <Button type="button" variant="outline" disabled={create.isPending || !value.trim()} onClick={save}>
            {create.isPending ? <Spinner data-icon="inline-start" /> : null}
            Add key
          </Button>
        </div>
      </Field>
      {target.host ? null : (
        <Field>
          <FieldLabel htmlFor={`${id}-hosts`}>Websites</FieldLabel>
          <Input
            id={`${id}-hosts`}
            placeholder="api.example.com"
            value={hosts}
            onChange={(event) => setHosts(event.target.value)}
          />
          <FieldDescription>Ren adds the key only to requests to these hosts.</FieldDescription>
        </Field>
      )}
      {create.error ? <FieldError>{errorMessage(create.error)}</FieldError> : null}
    </div>
  )
}
