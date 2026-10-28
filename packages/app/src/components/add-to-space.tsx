import type { AppProfileInfo, SpaceInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Dialog } from "@ren/ui/dialog"
import { Icon } from "@ren/ui/icon"
import { List } from "@ren/ui/list"
import { Menu } from "@ren/ui/menu"
import { Toast } from "@ren/ui/toast"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
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
    Toast.manager.add({ type: "error", title: `Couldn’t add ${props.app.name}`, description: error.message })
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
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              appearance={props.appearance ?? "secondary"}
              size="small"
              pending={addition.pending}
              trailingIcon={<Icon glyph="ChevronDown" />}
              aria-label={`Add ${props.app.name} to a space`}
            >
              Add to space
            </Button>
          }
        />
        <Menu.Popup alignment="end" width="medium">
          <Menu.Section label="Your spaces">
            {props.spaces.map((space) => {
              const added = props.profiles.some((profile) => Apps.lists(profile, space))
              return (
                <Menu.Item
                  key={space.id}
                  icon={<Icon glyph={added ? "Check" : "Cube"} />}
                  onSelect={() =>
                    added
                      ? void navigate({
                          to: "/spaces/$spaceId/apps",
                          params: { spaceId: space.id },
                          search: { app: props.app.id },
                        })
                      : addition.add(space)
                  }
                >
                  {space.name}
                </Menu.Item>
              )
            })}
          </Menu.Section>
        </Menu.Popup>
      </Menu.Root>
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
      <Button appearance="plain" size="small" disabled leadingIcon={<Icon glyph="Check" />}>
        Added
      </Button>
    )
  return (
    <>
      <Button appearance="secondary" size="small" pending={addition.pending} onClick={() => addition.add(props.space)}>
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
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={props.pending ? "blocked" : "allowed"}
    >
      <Dialog.Content size="small">
        <Dialog.Header>
          <Dialog.Title>{`Add ${props.app.name} to ${props.space.name}`}</Dialog.Title>
          <Dialog.Description>
            Use an account already connected, or connect a new one for this space.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <List.Root label="Accounts">
            {props.shared.map((profile) => (
              <List.Item
                key={profile.id}
                title={profile.name}
                description={Apps.reach(profile)}
                trailing={
                  <Button
                    appearance="secondary"
                    size="small"
                    disabled={props.pending}
                    onClick={() => props.onUse(profile)}
                  >
                    Use
                  </Button>
                }
              />
            ))}
            <List.Item
              title={`New account for ${props.space.name}`}
              description="Only this space uses it."
              trailing={
                <Button appearance="primary" size="small" disabled={props.pending} onClick={props.onCreate}>
                  Create
                </Button>
              }
            />
          </List.Root>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  )
}
