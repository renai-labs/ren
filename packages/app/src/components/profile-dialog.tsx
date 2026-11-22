import { SkeletonRows } from "./page.js"
import { useState, type ReactNode } from "react"
import { Apps, type AppProfileInfo, type AppProfileItem, type SpaceInfo } from "@ren/client"
import { Credential } from "@ren/schema/credential"
import { SpaceApps } from "@ren/client/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "@ren/ui/sonner"
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconCube,
  IconLock,
} from "@tabler/icons-react"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia } from "@ren/ui/empty"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { RadioGroup, RadioGroupItem } from "@ren/ui/radio-group"
import { Spinner } from "@ren/ui/spinner"
import { AccountAccess } from "./account-actions.js"
import { toastRemoved } from "./space-removal.js"
import { AppIcon } from "./app-icon.js"
import { DeleteAccount } from "./account-menu.js"
import { AccountList, SpacePills } from "./app-list.js"
import { StatusDot } from "./status-dot.js"
import { Row, Rows } from "./page.js"
import { SpacesField } from "./spaces-field.js"
import { Platform } from "../platform/platform.js"
import { useApp, useApps } from "../lib/use-app.js"
import { useAppProfiles } from "../lib/use-app-profiles.js"
import { useBundleParts, type BundlePart } from "../lib/use-bundle-parts.js"
import { useMembers } from "../lib/use-members.js"
import { useSignIn } from "../lib/use-sign-in.js"
import { useSpaces } from "../lib/use-spaces.js"
import { useMe } from "../lib/use-me.js"
import { errorMessage } from "../lib/errors.js"
import { plural } from "../lib/format.js"
import {
  gaps,
  hasManaged,
  isBundle,
  listNames,
  listsSpace,
  reachedSpaces,
  replacesManaged,
  signsIn,
  slugOf,
  statusLabel,
  statusOf,
  type CatalogApp,
  type Status,
} from "../lib/apps.js"
import { cn } from "cn"
import { RouterContext } from "../lib/router-context.js"

type App = CatalogApp
type AppProfile = AppProfileInfo
type From = Apps.From
type Mode = "resolve" | "reuse" | "fresh"

export type ProfileTarget = {
  appId: string
  profileId?: string | undefined
  from?: From | undefined
  edit?: boolean | undefined
  existing?: boolean | undefined
  newAccount?: boolean | undefined
}

export function useAddManaged() {
  const { api } = RouterContext.useRouterContext()
  return SpaceApps.useAccounts(api, slugOf).addManaged
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
}) {
  if (input.existing) return "existing"
  if (input.profileId) return input.edit ? input.section : "connect"
  return input.from ? "add" : "spaces"
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
    if (step === "add" && !props.from) return () => move("back", () => setFrom(undefined))
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
        className="flex max-h-[calc(100dvh-(--spacing(8)))] min-h-[min(--spacing(120),calc(100dvh-(--spacing(8))))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
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
  if (props.step === "spaces")
    return <SpacesStep app={app} newAccount={props.mode === "fresh"} onPick={props.onSpace} onClose={props.onClose} />
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
  const reaches = (profile: AppProfile) => Apps.reaches(profile, from, me)
  const usable = (profile: AppProfile) => Apps.usable(profile, from, me)
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
  return (
    <ResolveState
      {...state}
      profiles={profiles}
      options={options}
      locked={locked}
      credits={credits !== undefined}
      spare={spare}
    />
  )
}

// oxlint-disable-next-line ren/no-comments -- Whether the space picks between Managed by Ren and its own accounts: the app has Managed by Ren, and either it is in use, the app is not in the space yet, or an own account replaces it.
const managedChoiceOf = (input: { app: App; here: ReadonlyArray<AppProfile>; credits: boolean }) => {
  if (!hasManaged(input.app) || isBundle(input.app)) return false
  const connected = input.here.filter((profile) => gaps(profile).length === 0)
  if (connected.length > 0) return replacesManaged(input.app, connected)
  return input.credits || input.here.length === 0
}

// oxlint-disable-next-line ren/no-comments -- The state of the app in the space: own accounts connected, Managed by Ren (in use, or not added yet), accounts elsewhere, a locked account, or nothing yet.
function ResolveState(
  props: StateProps & {
    profiles: ReadonlyArray<AppProfile>
    options: ReadonlyArray<AppProfile>
    locked: AppProfile | undefined
    credits: boolean
    spare: AppProfile | undefined
  },
) {
  const here = props.here
  const app = props.app
  const managed = managedChoiceOf({ app, here, credits: props.credits })
  if (managed) return <ManagedState {...props} active={props.credits} />
  if (here.some((profile) => gaps(profile).length === 0)) return <WorkingState {...props} />
  if (props.options.length > 0) return <ExistingState {...props} />
  if (props.locked) return <LockedState {...props} locked={props.locked} />
  return (
    <NewStep
      {...props}
      others={props.profiles}
      reuse={props.spare}
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
        from={props.from}
        onOpen={(profile) => props.onOpen(profile.id)}
      />
    </div>
  )
}

const previewCaption = (part: BundlePart, from: Target) => {
  if (part.status !== "absent") return `Already in ${from.name}`
  if (hasManaged(part.app)) return "Managed by Ren"
  return signsInFirst(part.app, undefined) ? "Needs sign-in" : "Ready"
}

const addedCaption = (part: BundlePart, from: Target) => {
  if (part.status === "absent") return `Not in ${from.name}`
  if (part.status === "expired") return "Sign-in expired"
  if (part.status === "missing") return "Needs sign-in"
  if (part.status === "credits") return "Managed by Ren"
  const holder = part.here.flatMap((profile) => profile.items).find((item) => item.holder)?.holder
  return holder ? `Connected as ${holder.name}` : "Connected"
}

const partAction = (status: BundlePart["status"]) => {
  if (status === "absent") return "Add"
  if (status === "expired") return "Reconnect"
  return status === "missing" ? "Connect" : undefined
}

function BundleApps(props: {
  parts: ReadonlyArray<BundlePart>
  pending: boolean
  count: number
  from: Target
  added: boolean
}) {
  const [opened, setOpened] = useState<string>()
  return (
    <section className="flex w-full flex-col gap-1 text-left" aria-label="Apps">
      <h3 className="text-sm font-medium">
        Apps
        <span className="ml-1.5 text-muted-foreground tabular-nums">{props.count}</span>
      </h3>
      {props.pending ? (
        <SkeletonRows count={props.count} label="Loading apps" />
      ) : (
        <ul className="-mx-2 flex flex-col">
          {props.parts.map((part) => {
            const action = props.added ? partAction(part.status) : undefined
            const status = part.status === "absent" ? "missing" : part.status
            return (
              <li key={part.app.id} className="flex min-h-14 items-center gap-3 p-2">
                <AppIcon name={part.app.name} description={part.app.description} icon={part.app.icon} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm" title={part.app.name}>
                    {part.app.name}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {props.added ? <StatusDot status={status} /> : null}
                    <span className="truncate">
                      {props.added ? addedCaption(part, props.from) : previewCaption(part, props.from)}
                    </span>
                  </span>
                </span>
                {action ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    aria-label={`${action} ${part.app.name}`}
                    onClick={() => setOpened(part.app.id)}
                  >
                    {action}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {opened ? <ProfileDialog appId={opened} from={props.from} onClose={() => setOpened(undefined)} /> : null}
    </section>
  )
}

const bundleSummary = (parts: ReadonlyArray<BundlePart>) => {
  const signIn = parts.filter((part) => part.status === "missing" || part.status === "expired").length
  const absent = parts.filter((part) => part.status === "absent").length
  if (signIn + absent === 0) return <StatusLine status="connected">Ready</StatusLine>
  return (
    <StatusLine status="missing">
      {[
        signIn > 0 ? `${plural(signIn, "app")} ${signIn === 1 ? "needs" : "need"} sign-in` : "",
        absent > 0 ? `${plural(absent, "app")} missing` : "",
      ]
        .filter(Boolean)
        .join(" · ")}
    </StatusLine>
  )
}

function BundleState(props: StateProps) {
  const bundle = useBundleParts(props.app, props.from)
  return (
    <Screen
      app={props.app}
      title={props.title}
      description={bundle.pending ? "Checking apps" : bundleSummary(bundle.parts)}
      onSubmit={props.onClose}
      action={
        <Button type="submit" className={primary}>
          Done
        </Button>
      }
    >
      <BundleApps
        parts={bundle.parts}
        pending={bundle.pending}
        count={props.app.dependsOn.length}
        from={props.from}
        added
      />
    </Screen>
  )
}

function WorkingState(props: StateProps) {
  if (isBundle(props.app)) return <BundleState {...props} />
  return <WorkingAccounts {...props} />
}

function WorkingAccounts(props: StateProps) {
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

const addsLine = (props: { app: App }) =>
  isBundle(props.app) ? `Adds ${plural(props.app.dependsOn.length, "app")}` : undefined

// oxlint-disable-next-line ren/no-comments -- An own-account app with usable accounts elsewhere: the same connection list as Managed by Ren, with one of them or a new account.
function ExistingState(props: StateProps & { options: ReadonlyArray<AppProfile> }) {
  const first = props.options.at(0)
  const [choice, setChoice] = useState(first?.id ?? newChoice)
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
  const picked = props.options.find((profile) => profile.id === choice)
  const button = (
    <Button type="submit" className={primary} disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" /> : null}
      {picked ? `Use in ${from.name}` : "Connect account"}
    </Button>
  )
  if (confirming && picked)
    return (
      <Screen
        app={props.app}
        title={`Use ${picked.name} in ${from.name}?`}
        description={`Everyone in ${from.name} (${plural(from.members, "person", "people")}) can then use it. ${staysIn(picked)}`}
        onSubmit={() => addHere(picked)}
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
      description={addsLine(props) ?? <StatusLine status={props.status}>{statusLabel[props.status]}</StatusLine>}
      onSubmit={() => {
        if (!picked) return props.onMode("reuse")
        if (!from.private && from.members > 1) return setConfirming(true)
        addHere(picked)
      }}
      action={
        <>
          {button}
          <Button type="button" variant="ghost" className={secondary} onClick={props.onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <FieldSet className="w-full text-left">
        <FieldLegend variant="label">Connection</FieldLegend>
        <RadioGroup
          value={choice}
          onValueChange={(value) => {
            if (typeof value === "string") setChoice(value)
          }}
        >
          {props.options.map((profile) => (
            <ConnectionOption
              key={profile.id}
              value={profile.id}
              title={profile.name}
              caption={accountCaption(profile)}
              inUse={false}
            />
          ))}
          <ConnectionOption
            value={newChoice}
            title={isBundle(props.app) ? "New account" : "Connect a new account"}
            caption={`Sign in with another ${props.app.name} account.`}
            inUse={false}
          />
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

const managedChoice = "managed"

const newChoice = "new"

function ConnectionOption(props: {
  value: string
  title: ReactNode
  caption: ReactNode
  inUse: boolean
  disabled?: boolean | undefined
}) {
  const id = `connection-${props.value}`
  return (
    <FieldLabel htmlFor={id}>
      <Field orientation="horizontal" data-disabled={props.disabled}>
        <FieldContent>
          <FieldTitle>
            {props.title}
            {props.inUse ? (
              <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                <StatusDot status="connected" />
                In use
              </span>
            ) : null}
          </FieldTitle>
          <FieldDescription>{props.caption}</FieldDescription>
        </FieldContent>
        <RadioGroupItem id={id} value={props.value} disabled={props.disabled} />
      </Field>
    </FieldLabel>
  )
}

const accountCaption = (profile: AppProfile) => {
  const holder = profile.items.find((item) => item.holder)?.holder
  const where = reachedSpaces(profile)
  return [
    holder ? `Connected as ${holder.name}` : "Your account",
    where.length > 0 ? `in ${listNames(where)}` : undefined,
  ]
    .filter(Boolean)
    .join(" ")
}

const leavesSpace = (profile: AppProfile, from: Target) =>
  profile.kind === "shared" &&
  !profile.allSpaces &&
  profile.spaces.some((space) => space.id === from.spaceId) &&
  profile.canRemove.some((shape) => shape === "joined" || shape === "shared")

type Switch = { readonly to: "managed" } | { readonly to: "account"; readonly profile: AppProfile }

function useConnectionSwitch(props: StateProps & { inUse: ReadonlyArray<AppProfile> }) {
  const { api } = RouterContext.useRouterContext()
  const addManaged = useAddManaged()
  const access = useMutation(api["app-profile"].access.mutationOptions())
  const promote = useMutation(api["app-profile"].promote.mutationOptions())
  const adding = useMutation({ mutationFn: () => addManaged(props.app, props.from) })
  const from = props.from
  const app = props.app
  const done = (message: string) => () => {
    toast.success(message)
    props.onClose()
  }
  const failed = (message: string) => (error: unknown) => toast.error(message, { description: errorMessage(error) })
  return {
    pending: access.isPending || promote.isPending || adding.isPending,
    addManaged: () =>
      adding.mutate(undefined, {
        onSuccess: done(`${app.name} added to ${from.name}`),
        onError: failed(`Couldn’t add ${app.name} to ${from.name}`),
      }),
    toManaged: () =>
      void Promise.all(
        props.inUse.map((profile) => access.mutateAsync({ id: profile.id, remove: [from.spaceId] })),
      ).then(done(`${from.name} uses Managed by Ren for ${app.name}`), failed("Couldn’t switch to Managed by Ren")),
    toAccount: (profile: AppProfile) =>
      void (
        profile.kind === "private"
          ? promote.mutateAsync({ id: profile.id, spaceId: from.spaceId })
          : access.mutateAsync({ id: profile.id, add: [from.spaceId] })
      ).then(
        done(`${from.name} uses ${profile.name} for ${app.name}`),
        failed(`Couldn’t use ${profile.name} in ${from.name}`),
      ),
  }
}

const switchCopy = (input: { change: Switch; from: Target; app: App; inUse: ReadonlyArray<AppProfile> }) => {
  const from = input.from
  if (input.change.to === "managed") {
    const names = listNames(input.inUse.map((profile) => profile.name))
    const others = [...new Set(input.inUse.flatMap(reachedSpaces))].filter((name) => name !== from.name)
    return {
      title: `Switch ${from.name} to Managed by Ren?`,
      description: [
        `${names} ${input.inUse.length === 1 ? "leaves" : "leave"} ${from.name}. Chats there use Ren’s ${input.app.name} account, paid with Ren credits.`,
        others.length > 0 ? `${input.inUse.length === 1 ? "It stays" : "They stay"} in ${listNames(others)}.` : "",
      ].join(" "),
      action: "Switch to Managed by Ren",
    }
  }
  const profile = input.change.profile
  return {
    title: `Switch ${from.name} to ${profile.name}?`,
    description: [
      input.inUse.length === 0
        ? `Chats in ${from.name} stop using Ren credits for ${input.app.name}.`
        : `Chats in ${from.name} use it beside ${listNames(input.inUse.map((each) => each.name))}.`,
      from.private ? "" : `Everyone in ${from.name} (${plural(from.members, "person", "people")}) can use it.`,
      staysIn(profile),
    ].join(" "),
    action: "Switch account",
  }
}

const currentLabel = (current: string, inUse: ReadonlyArray<AppProfile>) =>
  current === managedChoice ? statusLabel.credits : "Connected · your own account"

function submitChoice(input: {
  choice: string
  current: string | undefined
  picked: AppProfile | undefined
  asks: boolean
  onClose: () => void
  onNew: () => void
  onConfirm: (change: Switch) => void
  onAddManaged: () => void
  onAccount: (profile: AppProfile) => void
}) {
  if (input.choice === input.current) return input.onClose()
  if (input.choice === newChoice) return input.onNew()
  if (input.choice === managedChoice) return input.current ? input.onConfirm({ to: "managed" }) : input.onAddManaged()
  if (!input.picked) return input.onClose()
  if (input.asks) return input.onConfirm({ to: "account", profile: input.picked })
  input.onAccount(input.picked)
}

// oxlint-disable-next-line ren/no-comments -- An app with Managed by Ren: one list of every way the space can connect, with the one in use marked. Nothing changes until the person picks another way and confirms it.
function ManagedState(
  props: StateProps & {
    options: ReadonlyArray<AppProfile>
    active: boolean
  },
) {
  const from = props.from
  const app = props.app
  const inUse = props.here.filter((profile) => gaps(profile).length === 0)
  const current = inUse.at(0)?.id ?? (props.active ? managedChoice : undefined)
  const [choice, setChoice] = useState(current ?? managedChoice)
  const [confirming, setConfirming] = useState<Switch>()
  const change = useConnectionSwitch({ ...props, inUse })
  const picked = props.options.find((profile) => profile.id === choice)
  const locked =
    current !== undefined && current !== managedChoice && !inUse.every((profile) => leavesSpace(profile, from))
  const submit = () =>
    submitChoice({
      choice,
      current,
      picked,
      asks: current !== undefined || (!from.private && from.members > 1),
      onClose: props.onClose,
      onNew: () => props.onMode(props.active ? "reuse" : "fresh"),
      onConfirm: setConfirming,
      onAddManaged: change.addManaged,
      onAccount: change.toAccount,
    })
  const spinner = change.pending ? <Spinner data-icon="inline-start" /> : null
  if (confirming) {
    const copy = switchCopy({ change: confirming, from, app, inUse })
    return (
      <Screen
        app={app}
        title={copy.title}
        description={copy.description}
        onSubmit={() => (confirming.to === "managed" ? change.toManaged() : change.toAccount(confirming.profile))}
        action={
          <>
            <Button type="submit" className={primary} disabled={change.pending}>
              {spinner}
              {copy.action}
            </Button>
            <Button type="button" variant="ghost" className={secondary} onClick={() => setConfirming(undefined)}>
              Cancel
            </Button>
          </>
        }
      />
    )
  }
  return (
    <Screen
      app={app}
      title={props.title}
      description={
        current ? (
          <StatusLine status="connected">{currentLabel(current, inUse)}</StatusLine>
        ) : (
          `Choose how ${from.name} connects to ${app.name}.`
        )
      }
      onSubmit={submit}
      action={
        <>
          <Button type="submit" className={primary} disabled={change.pending}>
            {spinner}
            {choiceButton({ choice, current, from })}
          </Button>
          <Button type="button" variant="ghost" className={secondary} onClick={props.onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <FieldSet className="w-full text-left">
        <FieldLegend variant="label">Connection</FieldLegend>
        <RadioGroup
          value={choice}
          onValueChange={(value) => {
            if (typeof value === "string") setChoice(value)
          }}
        >
          <ConnectionOption
            value={managedChoice}
            title="Managed by Ren"
            caption={
              locked
                ? `Remove your account from ${from.name} in its settings to switch back.`
                : "Paid with Ren credits. Nothing to connect."
            }
            inUse={current === managedChoice}
            disabled={locked}
          />
          {[...inUse, ...props.options].map((profile) => (
            <ConnectionOption
              key={profile.id}
              value={profile.id}
              title={profile.name}
              caption={accountCaption(profile)}
              inUse={profile.id === current}
            />
          ))}
          <ConnectionOption
            value={newChoice}
            title="Connect a new account"
            caption={`Use your own ${app.name} plan instead of Ren credits.`}
            inUse={false}
          />
        </RadioGroup>
      </FieldSet>
    </Screen>
  )
}

const choiceButton = (input: { choice: string; current: string | undefined; from: Target }) => {
  if (input.choice === input.current) return "Done"
  if (input.choice === newChoice) return "Connect account"
  if (input.choice === managedChoice) return input.current ? "Switch to Managed by Ren" : `Add to ${input.from.name}`
  return input.current ? "Switch account" : `Use in ${input.from.name}`
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
  return Apps.signsInFirst(app)
}

function BundlePreview(props: {
  app: App
  from: Target
  parts: { pending: boolean; parts: ReadonlyArray<BundlePart> }
}) {
  if (!isBundle(props.app)) return null
  return (
    <BundleApps
      parts={props.parts.parts}
      pending={props.parts.pending}
      count={props.app.dependsOn.length}
      from={props.from}
      added={false}
    />
  )
}

const newStepCopy = (input: {
  from: Target
  start: "add" | "connect"
  bundle: { count: number; adds: ReadonlyArray<string> } | undefined
}) => {
  const who = input.from.private
    ? "Only you can use this account."
    : `Everyone in ${input.from.name} can use this account.`
  if (!input.bundle) return { label: input.start === "add" ? `Add to ${input.from.name}` : "Connect", note: who }
  return {
    label: `Add to ${input.from.name}`,
    note: input.bundle.adds.length > 0 ? "Each app’s account gets this name." : who,
    description: `Adds ${plural(input.bundle.count, "app")}`,
  }
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
  const parts = useBundleParts(app, from)
  const copy = newStepCopy({
    from,
    start: props.start,
    bundle: isBundle(app)
      ? {
          count: app.dependsOn.length,
          adds: parts.parts.filter((part) => part.status === "absent").map((part) => part.app.name),
        }
      : undefined,
  })
  const accountName =
    name ??
    reuse?.name ??
    Apps.defaultName({ from, only: from.private, picked: new Set(), spaces: [], others: props.others, app, user })
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
        slug: Apps.freeSlug(trimmed, new Set(props.others.map((each) => each.slug)), slugOf),
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
      description={copy.description ?? <StatusLine status={status}>{statusLabel[status]}</StatusLine>}
      onSubmit={submit}
      action={
        <>
          {error ? <FieldError className="text-center">{errorMessage(error)}</FieldError> : null}
          <Button type="submit" className={primary} disabled={pending || !accountName.trim()}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {copy.label}
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
        <FieldDescription>{copy.note}</FieldDescription>
      </Field>
      <BundlePreview app={app} from={from} parts={parts} />
    </Screen>
  )
}

function SpacesStep(props: { app: App; newAccount: boolean; onPick: (space: From) => void; onClose: () => void }) {
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
      title={props.newAccount ? `New ${app.name} account` : `Add ${app.name} to a space`}
      description={
        props.newAccount ? "Pick the space that uses it." : `Pick a space. Everyone in it can use ${app.name}.`
      }
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
                  if (!isAdded || props.newAccount)
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
  app: Pick<App, "name" | "icon"> & { readonly description?: string | null }
  title: string
  description?: ReactNode
  children?: ReactNode
  action: ReactNode
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
      <Empty className="min-h-0 justify-start gap-8 overflow-y-auto overscroll-contain px-10 pt-12 pb-6">
        <EmptyHeader className="max-w-xs gap-3">
          <EmptyMedia className="mb-3">
            <AppIcon
              name={props.app.name}
              description={props.app.description}
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
  const leftEvery = profile.allSpaces && !every
  const dropped = [
    ...(leftEvery ? ["every space"] : []),
    ...profile.spaces.filter((space) => remove.includes(space.id)).map((space) => space.name),
  ]
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
            {
              onSuccess: (info) => {
                if (dropped.length > 0)
                  toastRemoved(info, dropped.join(", "), {
                    onUndo: () =>
                      access.mutateAsync({
                        id: profile.id,
                        ...(remove.length > 0 && { add: remove }),
                        ...(leftEvery && { allSpaces: true }),
                      }),
                  })
                onDone()
              },
            },
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
  const included = useApps(props.app.dependsOn)
  const names = props.app.dependsOn.map((slug) => included.of(slug)?.name ?? slug)
  return (
    <Screen
      app={props.app}
      title={`Edit ${props.app.name} account`}
      onSubmit={edit.submit}
      action={
        <>
          {edit.error ? <FieldError className="text-center">{errorMessage(edit.error)}</FieldError> : null}
          <Button type="submit" className="h-10 w-full" disabled={edit.pending}>
            {edit.pending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
          <DeleteAccount profile={profile} app={props.app} onDeleted={props.onDone} />
        </>
      }
    >
      <FieldGroup className="w-full gap-6">
        {profile.items.length > 0 ? (
          <ConnectionField app={props.app} profile={profile} onConnection={props.onConnection} />
        ) : null}
        <Field className="text-left">
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <Input id="profile-name" required value={edit.name} onChange={(event) => edit.setName(event.target.value)} />
        </Field>
        {edit.shared ? (
          <SpacesField
            spaces={spaces}
            picked={edit.picked}
            onPick={edit.setPicked}
            {...(profile.canShareEverySpace && { every: { checked: edit.every, onChange: edit.setEvery } })}
          />
        ) : null}
        {edit.shared && names.length > 0 ? (
          <FieldDescription className="-mt-4 text-left">New spaces also get {listNames(names)}.</FieldDescription>
        ) : null}
      </FieldGroup>
    </Screen>
  )
}

const connectionRow = (status: Status, profile: AppProfile) => {
  if (status === "credits") return { label: "Managed by Ren", action: "Use own account" }
  if (gaps(profile).length > 0) return { label: "Not connected", action: "Connect" }
  return { label: connectionLabel(profile), action: "Manage" }
}

function ConnectionField(props: { app: App; profile: AppProfile; onConnection: () => void }) {
  const status = statusOf(props.app, [props.profile])
  const row = connectionRow(status, props.profile)
  return (
    <Field className="text-left">
      <FieldLabel>Connection</FieldLabel>
      <Button
        variant="ghost"
        onClick={props.onConnection}
        className="group/row flex h-11 justify-start gap-3 border-border bg-card px-3 text-left font-normal hover:bg-muted/60 hover:text-inherit focus-visible:border-border active:not-aria-[haspopup]:scale-100"
      >
        <StatusDot status={status} />
        <span className="flex-1 truncate">{row.label}</span>
        <span className="text-xs text-muted-foreground">{row.action}</span>
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
  const target = keyTarget(keyItem, props.app)
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
    saveKey.mutate(
      {
        payload: {
          owner: { kind: "profile", profileId: profile.id },
          item: keyItem.item,
          hosts: Credential.splitHosts(target.host),
          value: target.field ? { type: "fields", fields: { [target.field]: value } } : { type: "key", value },
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
      note={[
        status === "credits" ? "Once it’s connected, your account replaces Managed by Ren." : undefined,
        oauthItem ? `You’ll sign in to ${props.app.name} in a small window, then come back here.` : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
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
          <FieldLabel htmlFor="profile-key">{target.copy.label}</FieldLabel>
          <Input
            id="profile-key"
            type="password"
            required
            autoComplete="off"
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the key is the only thing this step asks for
            autoFocus
            placeholder={target.copy.placeholder}
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
  const keyItem = props.profile.items.find((item) => !signsIn(item))
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
          {!oauthItem && keyItem ? (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={props.onReplace}>
              {keyTarget(keyItem, props.app).copy.replace}
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

const secretCopy = {
  key: {
    label: "API key",
    placeholder: "Paste your API key",
    add: "Add key",
    replace: "Replace key",
    saved: "Key saved",
  },
  token: {
    label: "Token",
    placeholder: "Paste your token",
    add: "Add token",
    replace: "Replace token",
    saved: "Token saved",
  },
}

function keyTarget(item: AppProfileItem | undefined, app: App) {
  const mcp = item && "mcp" in item.item ? app.mcps?.[item.item.mcp] : undefined
  if (!mcp) return { field: undefined, host: "", copy: secretCopy.key }
  const auth = mcp.auth
  const transport = mcp.transport
  return {
    field: "credential" in auth ? auth.credential : undefined,
    host: transport.type === "remote" ? (URL.parse(transport.url)?.hostname ?? "") : "",
    copy: secretCopy[auth.type === "bearer" ? "token" : "key"],
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
      <Row title={target.copy.label} description="Saved" media={<IconCheck className="size-4 text-chart-2" />}>
        <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
          {target.copy.replace}
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
          toast.success(target.copy.saved)
        },
      },
    )
  }
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <Field>
        <FieldLabel htmlFor={id}>{target.copy.label}</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            placeholder={target.copy.placeholder}
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
            {target.copy.add}
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
