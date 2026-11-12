import type { ReactNode } from "react"
import type { AppProfileInfo, SpaceInfo } from "@ren/client"
import { IconArrowRight, IconCheck, IconCopy, IconCube, IconLock } from "@tabler/icons-react"
import { useMutation } from "@tanstack/react-query"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { cn } from "cn"
import { AppIcon } from "../../components/app-icon.js"
import { Platform } from "../../platform/platform.js"
import { listsSpace, reachedSpaces, type CatalogApp } from "../../lib/apps.js"
import { errorMessage } from "../../lib/errors.js"
import { plural } from "../../lib/format.js"
import { RouterContext } from "../../lib/router-context.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { useSpaces } from "../../lib/use-spaces.js"

type Request = { app: CatalogApp; profile: AppProfileInfo; space: SpaceInfo; onClose: () => void }

const reaches = (profile: AppProfileInfo, space: SpaceInfo) =>
  profile.kind === "private"
    ? space.kind === "private" && space.ownerUserId === profile.userId
    : listsSpace(profile, space.id)

const shapeOf = (space: SpaceInfo, me: string) => {
  if (space.kind === "private") return space.ownerUserId === me ? "ownPrivate" : "otherPrivate"
  return space.membershipId === null ? "shared" : "joined"
}

const canAdd = (profile: AppProfileInfo, space: SpaceInfo, me: string) =>
  profile.kind === "private"
    ? profile.userId === me && space.kind !== "private"
    : profile.canAccess && profile.canAdd.includes(shapeOf(space, me))

const audienceOf = (space: SpaceInfo) => (space.kind === "private" ? "Only you" : `Everyone in ${space.name}`)

const pill = "rounded-full px-2 font-normal"

const linkIcons = { add: IconArrowRight, locked: IconLock, done: IconCheck } as const

function Tile(props: { caption: string; children: ReactNode }) {
  return (
    <figure className="flex w-28 min-w-0 flex-col items-center gap-2">
      {props.children}
      <figcaption className="w-full truncate text-center text-sm text-muted-foreground">{props.caption}</figcaption>
    </figure>
  )
}

function Frame(props: {
  app: CatalogApp
  link?: { state: keyof typeof linkIcons; account: string; space: SpaceInfo }
  title: string
  description?: string | undefined
  details?: ReactNode
  action?: ReactNode
  pending?: boolean
  onClose: () => void
}) {
  const app = props.app
  const link = props.link
  const logo = (
    <AppIcon
      name={app.name}
      description={app.description}
      icon={app.icon}
      className="size-16 rounded-2xl text-2xl shadow-sm ring-1 ring-foreground/10"
    />
  )
  const LinkIcon = link ? linkIcons[link.state] : undefined
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onClose()
      }}
    >
      <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-md">
        <div
          className={cn("flex flex-col items-center gap-8 px-10 pt-12 text-center", props.action ? "pb-6" : "pb-12")}
        >
          {link && LinkIcon ? (
            <div className="flex items-start justify-center">
              <Tile caption={link.account}>{logo}</Tile>
              <div aria-hidden className="flex size-16 items-center">
                <span className={cn("flex-1 border-t", link.state === "locked" && "border-dashed")} />
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border bg-background text-muted-foreground",
                    link.state === "done" && "border-chart-2/40 text-chart-2",
                  )}
                >
                  <LinkIcon className="size-3.5" />
                </span>
                <span className={cn("flex-1 border-t", link.state === "locked" && "border-dashed")} />
              </div>
              <Tile caption={link.space.name}>
                <span
                  className={cn(
                    "grid size-16 place-items-center rounded-2xl bg-muted text-muted-foreground shadow-sm ring-1 ring-foreground/10",
                    link.state === "locked" && "opacity-60",
                  )}
                >
                  {link.space.kind === "private" ? <IconLock className="size-7" /> : <IconCube className="size-7" />}
                </span>
              </Tile>
            </div>
          ) : (
            logo
          )}
          <div className="flex flex-col gap-2">
            <DialogTitle className="text-xl/7 font-semibold text-balance">{props.title}</DialogTitle>
            {props.description ? (
              <DialogDescription className="text-balance">{props.description}</DialogDescription>
            ) : null}
          </div>
          {props.details}
        </div>
        {props.action ? <div className="flex flex-col px-10 pt-2 pb-8">{props.action}</div> : null}
      </DialogContent>
    </Dialog>
  )
}

function AddRequest(props: Request) {
  const { api } = RouterContext.useRouterContext()
  const access = useMutation(api["app-profile"].access.mutationOptions())
  const promote = useMutation(api["app-profile"].promote.mutationOptions())
  const profile = props.profile
  const space = props.space
  const pending = access.isPending || promote.isPending
  const before = profile.kind === "private" ? [] : reachedSpaces(profile)
  return (
    <Frame
      app={props.app}
      link={{ state: "add", account: profile.name, space }}
      title={`Add “${profile.name}” to ${space.name}?`}
      description={profile.kind === "private" ? "It stops being only yours." : undefined}
      details={
        <dl className="grid w-full grid-cols-[auto_1fr] gap-x-6 gap-y-3 rounded-xl border bg-card px-4 py-3 text-left text-sm">
          <dt className="text-muted-foreground">Spaces</dt>
          <dd className="flex min-w-0 flex-wrap gap-1">
            {before.map((name) => (
              <Badge key={name} variant="secondary" className={pill}>
                {name}
              </Badge>
            ))}
            <Badge className={pill}>+ {space.name}</Badge>
          </dd>
          <dt className="text-muted-foreground">Who can use</dt>
          <dd className="min-w-0">
            {space.kind === "private"
              ? audienceOf(space)
              : `${audienceOf(space)} · ${plural(space.memberCount, "person", "people")}`}
          </dd>
        </dl>
      }
      action={
        <Button
          className="h-10 w-full"
          disabled={pending}
          onClick={() =>
            void (
              profile.kind === "private"
                ? promote.mutateAsync({ id: profile.id, spaceId: space.id })
                : access.mutateAsync({ id: profile.id, add: [space.id] })
            ).then(
              () => {
                toast.success(`${profile.name} is now in ${space.name}`)
                props.onClose()
              },
              (error: unknown) =>
                toast.error(`Couldn’t add ${profile.name} to ${space.name}`, { description: errorMessage(error) }),
            )
          }
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Add to {space.name}
        </Button>
      }
      pending={pending}
      onClose={props.onClose}
    />
  )
}

function LockedRequest(props: Request) {
  const platform = Platform.usePlatform()
  const member = useMembers().member
  const profile = props.profile
  const space = props.space
  const app = props.app
  const write = platform.writeClipboardText
  const owner = profile.kind === "private" ? (member(profile.userId)?.name ?? "Its owner") : "An admin"
  const link = `${platform.appUrl}/apps/${app.slug}?${new URLSearchParams({ account: profile.slug, space: space.slug }).toString()}`
  return (
    <Frame
      app={app}
      link={{ state: "locked", account: profile.name, space }}
      title={`${owner} needs to add this account`}
      description={
        profile.kind === "private"
          ? `“${profile.name}” is ${owner}’s private account. Only ${owner} can add it to ${space.name}.`
          : `Only an admin can add “${profile.name}” to ${space.name}.`
      }
      action={
        write ? (
          <Button
            className="h-10 w-full"
            onClick={() =>
              void write(
                `Can you add the ${app.name} account “${profile.name}” to ${space.name} in Ren?\n${link}`,
              ).then(
                () => toast.success("Request copied", { description: `Send it to ${owner}.` }),
                (error: unknown) => toast.error("Couldn’t copy the request", { description: errorMessage(error) }),
              )
            }
          >
            <IconCopy data-icon="inline-start" />
            Copy request for {owner}
          </Button>
        ) : null
      }
      onClose={props.onClose}
    />
  )
}

export function ShareRequest(props: {
  app: CatalogApp
  account: string
  space: string
  onChat: (spaceId: string) => void
  onClose: () => void
}) {
  const me = useMe().user.id
  const spaces = useSpaces().spaces
  const listed = useAppProfiles([props.app.id])
  if (listed.pending) return null
  const profile = listed.of(props.app.id).find((each) => each.slug === props.account || each.id === props.account)
  const space = spaces.find((each) => each.slug === props.space || each.id === props.space)
  if (!profile || !space)
    return (
      <Frame
        app={props.app}
        title="This link no longer works"
        description="The account or the space was deleted, or you can’t see it."
        onClose={props.onClose}
      />
    )
  if (reaches(profile, space))
    return (
      <Frame
        app={props.app}
        link={{ state: "done", account: profile.name, space }}
        title={`“${profile.name}” is in ${space.name}`}
        description={`${audienceOf(space)} can use it.`}
        action={
          <Button
            className="h-10 w-full"
            onClick={() => {
              props.onChat(space.id)
              props.onClose()
            }}
          >
            Chat in {space.name}
          </Button>
        }
        onClose={props.onClose}
      />
    )
  const request = { app: props.app, profile, space, onClose: props.onClose }
  return canAdd(profile, space, me) ? <AddRequest {...request} /> : <LockedRequest {...request} />
}
