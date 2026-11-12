import { SkeletonRows } from "./page.js"
import { useState, type ReactNode } from "react"
import type { AppProfileInfo, AppProfileItem } from "@ren/client"
import { Credential } from "@ren/schema/credential"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import {
  IconAlertTriangle,
  IconBuilding,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCube,
  IconLock,
  IconSearch,
} from "@tabler/icons-react"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia } from "@ren/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { Spinner } from "@ren/ui/spinner"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Switch } from "@ren/ui/switch"
import { AccountAccess } from "./account-actions.js"
import { AppIcon } from "./app-icon.js"
import { SpacePills } from "./app-list.js"
import { ConfirmDialog } from "./confirm-dialog.js"
import { Row, Rows } from "./page.js"
import { useApp, useApps } from "../lib/use-app.js"
import { useAppProfiles } from "../lib/use-app-profiles.js"
import { useSignIn } from "../lib/use-sign-in.js"
import { useSpaces } from "../lib/use-spaces.js"
import { useMe } from "../lib/use-me.js"
import { errorMessage } from "../lib/errors.js"
import { gaps, reachedSpaces, signsIn, slugOf, type CatalogApp } from "../lib/apps.js"
import { Search } from "../lib/search.js"
import { cn } from "cn"
import { useScrollEdges } from "../lib/use-scroll-edges.js"
import { RouterContext } from "../lib/router-context.js"

type App = CatalogApp
type AppProfile = AppProfileInfo
type From = { spaceId: string; name: string; members: number; private?: boolean }

export type ProfileTarget = {
  appId: string
  profileId?: string | undefined
  from?: From | undefined
  edit?: boolean | undefined
  existing?: boolean | undefined
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

const slideIn = "animate-in duration-250 ease-out fade-in-0 slide-in-from-right-4 motion-reduce:slide-in-from-right-0"
const slideBack = "animate-in duration-250 ease-out fade-in-0 slide-in-from-left-4 motion-reduce:slide-in-from-left-0"

function stepMotion(input: { fresh: boolean; creating: boolean; step: string; back: boolean }) {
  return cn(
    ((input.fresh && !input.creating) || input.step === "connection") && slideIn,
    input.step === "edit" && input.back && slideBack,
  )
}

function stepOf(input: { creating: boolean; existing: boolean; edit: boolean; section: "edit" | "connection" }) {
  if (input.existing) return "existing"
  if (input.creating) return "create"
  return input.edit ? input.section : "connect"
}

export function ProfileDialog(props: ProfileTarget & { onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const found = useApp(props.appId)
  const [profileId, setProfileId] = useState(props.profileId)
  const [waiting, setWaiting] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [section, setSection] = useState<"edit" | "connection">("edit")
  const [back, setBack] = useState(false)
  const profile = useQuery({
    ...api["app-profile"].get.queryOptions({ idOrSlug: profileId ?? "" }),
    enabled: Boolean(profileId),
    refetchOnWindowFocus: "always",
    refetchInterval: waiting ? 2000 : false,
  })
  const app = found.app
  if (!app && !found.pending) return null
  const creating = !profileId
  const fresh = !props.profileId
  const step = stepOf({ creating, existing: Boolean(props.existing), edit: Boolean(props.edit), section })
  const go = (next: "edit" | "connection") => {
    setBack(next === "edit")
    setReplacing(false)
    setSection(next)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent // ast-grep-ignore: require-overlay-title -- each step renders its DialogTitle through Screen
        className="flex h-[min(--spacing(148),calc(100dvh-(--spacing(8))))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        {fresh && step !== "existing" ? (
          <span className="absolute top-4.5 left-5 text-xs text-muted-foreground tabular-nums">
            Step {creating ? 1 : 2} of 2
          </span>
        ) : null}
        {step === "connection" ? (
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-3 left-3 z-10 text-muted-foreground"
            onClick={() => go("edit")}
          >
            <IconChevronLeft data-icon="inline-start" />
            Back
          </Button>
        ) : null}
        <div key={step} className={cn("flex min-h-0 flex-1 flex-col", stepMotion({ fresh, creating, step, back }))}>
          {app ? (
            <ProfileStep
              app={app}
              profile={profile.data}
              step={step}
              from={props.from}
              replacing={replacing}
              waiting={waiting}
              onCreated={(created) => setProfileId(created.id)}
              onConnection={() => go("connection")}
              onClose={props.onClose}
              onDone={props.edit ? () => go("edit") : props.onClose}
              onReplace={() => setReplacing(true)}
              onSaved={() => setReplacing(false)}
              onWaiting={() => setWaiting(true)}
            />
          ) : (
            <Screen app={{ name: "", icon: null }} title="Loading app" description="" action={null}>
              <SkeletonRows count={2} label="Loading app" />
            </Screen>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProfileStep(props: {
  app: App
  profile: AppProfile | undefined
  step: ReturnType<typeof stepOf>
  from: From | undefined
  replacing: boolean
  waiting: boolean
  onCreated: (profile: AppProfile) => void
  onConnection: () => void
  onClose: () => void
  onDone: () => void
  onReplace: () => void
  onSaved: () => void
  onWaiting: () => void
}) {
  const app = props.app
  const profile = props.profile
  if (props.step === "existing" && props.from)
    return <ExistingStep app={app} from={props.from} onDone={props.onClose} />
  if (props.step === "create") return <CreateStep app={app} from={props.from} onCreated={props.onCreated} />
  if (props.step === "edit" && profile)
    return <EditStep app={app} profile={profile} onConnection={props.onConnection} onDone={props.onClose} />
  if (!profile)
    return (
      <Screen app={app} title={app.name} description={app.description} action={null}>
        <SkeletonRows count={2} label="Loading account" />
      </Screen>
    )
  if (profile.items.every((item) => item.optional || item.status === "ok") && !props.replacing)
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
      onSaved={props.onSaved}
      onWaiting={props.onWaiting}
      onDone={props.onDone}
    />
  )
}

function Screen(props: {
  app: Pick<App, "name" | "icon">
  title: string
  description: string
  children?: ReactNode
  action: ReactNode
  note?: ReactNode
  onSubmit?: () => void
}) {
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit?.()
      }}
    >
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
          <DialogDescription className="text-balance">{props.description}</DialogDescription>
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

function EditStep(props: { app: App; profile: AppProfile; onConnection: () => void; onDone: () => void }) {
  const profile = props.profile
  const spaces = useSpaces().joined.filter((space) => space.kind !== "private")
  const edit = useEditProfile(profile, props.onDone)
  return (
    <Screen
      app={props.app}
      title={`Edit ${props.app.name} account`}
      description={connectionLabel(profile)}
      onSubmit={edit.submit}
      action={
        <>
          {edit.error ? <FieldError className="text-center">{errorMessage(edit.error)}</FieldError> : null}
          <Button type="submit" className="h-10 w-full" disabled={edit.blocked}>
            {edit.pending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
          <DeleteAccount profile={profile} onDeleted={props.onDone} />
        </>
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

function DeleteAccount(props: { profile: AppProfile; onDeleted: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const remove = useMutation(api["app-profile-reach"]["app-profile"].delete.mutationOptions())
  const [confirming, setConfirming] = useState(false)
  const profile = props.profile
  const used = reachedSpaces(profile)
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-10 w-full text-destructive hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        Delete account
      </Button>
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

function createDescription(from: From | undefined) {
  if (!from) return "You’ll connect it next."
  if (from.private) return "Only you can use it. You’ll connect it next."
  return `For everyone in ${from.name}. You’ll connect it next.`
}

function CreateStep(props: { app: App; from: From | undefined; onCreated: (profile: AppProfile) => void }) {
  const { api } = RouterContext.useRouterContext()
  const others = useAppProfiles([props.app.id]).of(props.app.id)
  const user = useMe().user.name
  const spaces = useSpaces().joined.filter((space) => space.kind !== "private")
  const create = useMutation({ ...api["app-profile"].create.mutationOptions() })
  const [name, setName] = useState<string>()
  const [only, setOnly] = useState(props.from?.private === true)
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(props.from ? [props.from.spaceId] : spaces.slice(0, 1).map((space) => space.id)),
  )
  const from = props.from
  const blocked = !from && !only && picked.size === 0
  const accountName = name ?? defaultName({ from, only, picked, spaces, others, app: props.app, user })
  return (
    <Screen
      app={props.app}
      title={`New ${props.app.name} account`}
      description={createDescription(from)}
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
        {from ? null : (
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
        )}
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
  const screen = { app: props.app, title: props.app.name, description: props.app.description }
  if (profile.items.length > 1)
    return (
      <Screen
        {...screen}
        onSubmit={props.onDone}
        action={
          <Button type="submit" className="h-10 w-full">
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
  const missing = props.profile.oauthApps.filter((gate) => !gate.isConfigured)
  if (missing.length === 0) return null
  return (
    <>
      {missing.map((gate) => (
        <Alert key={gate.name} className="text-left">
          <IconAlertTriangle className="text-chart-3" />
          <AlertDescription>Set up the org OAuth app “{gate.name}” before you sign in.</AlertDescription>
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
