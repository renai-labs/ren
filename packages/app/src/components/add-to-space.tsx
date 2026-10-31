import type { AppProfileInfo, SpaceInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "@ren/ui/item"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/toast"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Fragment, useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { Apps } from "./apps.js"

type Target = Pick<SpaceInfo, "id" | "name">

// oxlint-disable-next-line ren/no-comments -- A space uses an app by reaching one of its profiles: add the space to a shared profile, or create one named after the space.
function useAddition(props: {
  app: Apps.Entry
  profiles: ReadonlyArray<AppProfileInfo>
  onAdded: (profileId: string) => void
}) {
  const context = RouterContext.useRouterContext()
  const create = useMutation(context.api["app-profile"].create.mutationOptions())
  const access = useMutation(context.api["app-profile"].access.mutationOptions())
  const [choosing, setChoosing] = useState<Target>()
  const shared = props.profiles.filter((profile) => profile.kind === "shared")
  const done = (profileId: string) => {
    setChoosing(undefined)
    props.onAdded(profileId)
  }
  const failed = (error: Error) =>
    toast.add({ type: "error", title: `Couldn’t add ${props.app.name}`, description: error.message })
  const createFor = (space: Target) =>
    create.mutate(
      {
        appId: props.app.id,
        name: space.name,
        slug: Apps.freeSlug(
          space.name,
          props.profiles.map((profile) => profile.slug),
        ),
        kind: "shared",
        spaceIds: [space.id],
      },
      { onSuccess: (created) => done(created.id), onError: failed },
    )
  const addTo = (profile: AppProfileInfo, space: Target) =>
    access.mutate({ id: profile.id, add: [space.id] }, { onSuccess: () => done(profile.id), onError: failed })
  return {
    add: (space: Target) => (shared.length > 0 ? setChoosing(space) : createFor(space)),
    pending: create.isPending || access.isPending,
    dialog: choosing ? (
      <ChooseProfile
        app={props.app}
        space={choosing}
        shared={shared}
        pending={create.isPending || access.isPending}
        onUse={(profile) => addTo(profile, choosing)}
        onCreate={() => createFor(choosing)}
        onClose={() => setChoosing(undefined)}
      />
    ) : null,
  }
}

export function AddToSpace(props: {
  app: Apps.Entry
  profiles: ReadonlyArray<AppProfileInfo>
  spaces: ReadonlyArray<SpaceInfo>
  appearance?: "primary" | "secondary"
  onAdded: (profileId: string) => void
}) {
  const navigate = useNavigate()
  const addition = useAddition(props)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant={props.appearance === "primary" ? "default" : "outline"}
              size={props.appearance === "primary" ? "default" : "sm"}
              disabled={addition.pending}
              aria-label={`Add ${props.app.name} to a space`}
            />
          }
        >
          {addition.pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          Add to space
          <Icon glyph="ChevronDown" data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Your spaces</DropdownMenuLabel>
            {props.spaces.map((space) => {
              const added = props.profiles.some((profile) => Apps.lists(profile, space))
              return (
                <DropdownMenuItem
                  key={space.id}
                  onClick={() =>
                    added
                      ? void navigate({
                          to: "/spaces/$spaceId/apps",
                          params: { spaceId: space.id },
                          search: { app: props.app.id },
                        })
                      : addition.add(space)
                  }
                >
                  <Icon glyph={added ? "Check" : "Cube"} />
                  {space.name}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {addition.dialog}
    </>
  )
}

// oxlint-disable-next-line ren/no-comments -- The same for one space, as the composer's Add an app dialog offers it.
export function AddHere(props: {
  app: Apps.Entry
  profiles: ReadonlyArray<AppProfileInfo>
  space: Target
  onAdded: (profileId: string) => void
}) {
  const addition = useAddition(props)
  if (props.profiles.some((profile) => Apps.lists(profile, props.space)))
    return (
      <Button variant="ghost" size="sm" disabled>
        <Icon glyph="Check" data-icon="inline-start" />
        Added
      </Button>
    )
  return (
    <>
      <Button
        variant="outline"
        size="sm"
                disabled={addition.pending}
        onClick={() => addition.add(props.space)}
      >
        {addition.pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
        Add
      </Button>
      {addition.dialog}
    </>
  )
}

function ChooseProfile(props: {
  app: Apps.Entry
  space: Target
  shared: ReadonlyArray<AppProfileInfo>
  pending: boolean
  onUse: (profile: AppProfileInfo) => void
  onCreate: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Add ${props.app.name} to ${props.space.name}`}</DialogTitle>
          <DialogDescription>Use an account already connected, or connect a new one for this space.</DialogDescription>
        </DialogHeader>
        <ItemGroup aria-label="Accounts" className="gap-0 rounded-xl border bg-card">
          {props.shared.map((profile) => (
            <Fragment key={profile.id}>
              <Item render={<li />} className="min-h-14 gap-x-6 gap-y-2 px-4 py-3">
                <ItemContent>
                  <ItemTitle className="leading-5">{profile.name}</ItemTitle>
                  <ItemDescription className="text-xs">{Apps.reach(profile)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                                        disabled={props.pending}
                    onClick={() => props.onUse(profile)}
                  >
                    Use
                  </Button>
                </ItemActions>
              </Item>
              <ItemSeparator className="my-0" />
            </Fragment>
          ))}
          <Item render={<li />} className="min-h-14 gap-x-6 gap-y-2 px-4 py-3">
            <ItemContent>
              <ItemTitle className="leading-5">{`New account for ${props.space.name}`}</ItemTitle>
              <ItemDescription className="text-xs">Only this space uses it.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button size="sm" disabled={props.pending} onClick={props.onCreate}>
                Create
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </DialogContent>
    </Dialog>
  )
}
