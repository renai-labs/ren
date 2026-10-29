import { useState } from "react"
import type { AppProfileInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { IconCheck, IconChevronDown, IconCube, IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Row, Rows } from "@/components/ren/page"
import { useCatalog } from "@/hooks/use-catalog"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage, profileQueries } from "@/lib/api"
import { listsSpace, reach, type CatalogApp } from "@/lib/apps"

type App = CatalogApp
type AppProfile = AppProfileInfo

type Target = { id: string; name: string }

export type Added = (added: { app: App; profileId?: string | undefined; space: Target }) => void

function useAddition(app: App, onAdded: Added) {
  const [choosing, setChoosing] = useState<Target>()
  const catalog = useCatalog()
  const access = useMutation({ ...api["app-profile"].access.mutationOptions(), meta: { invalidates: profileQueries } })
  const shared = catalog.profilesOf(app.id).filter((profile) => profile.kind === "shared")
  const done = (profileId: string | undefined, space: Target) => {
    setChoosing(undefined)
    if (!profileId) {
      onAdded({ app, space })
      return
    }
    access.mutate(
      { id: profileId, add: [space.id] },
      {
        onSuccess: () => {
          toast.success(`${app.name} added to ${space.name}`)
          onAdded({ app, profileId, space })
        },
        onError: (error) => toast.error(`Couldn’t add ${app.name}`, { description: errorMessage(error) }),
      },
    )
  }
  return {
    add: (space: Target) => (shared.length > 0 ? setChoosing(space) : done(undefined, space)),
    dialog: choosing ? (
      <ChooseProfile
        app={app}
        space={choosing}
        shared={shared}
        onUse={(profile) => done(profile.id, choosing)}
        onCreate={() => done(undefined, choosing)}
        onClose={() => setChoosing(undefined)}
      />
    ) : null,
  }
}

export function AddToSpace(props: { app: App; primary?: boolean; onAdded: Added }) {
  const navigate = useNavigate()
  const addition = useAddition(props.app, props.onAdded)
  const profiles = useCatalog().profilesOf(props.app.id)
  const yourSpaces = useSpaces().joined
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant={props.primary ? "default" : "ghost"}
              size={props.primary ? "default" : "icon"}
              className={props.primary ? undefined : "text-muted-foreground"}
              aria-label={`Add ${props.app.name} to a space`}
            />
          }
        >
          {props.primary ? (
            <>
              Add to space
              <IconChevronDown />
            </>
          ) : (
            <IconPlus />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Your spaces</DropdownMenuLabel>
            {yourSpaces.map((space) => {
              const added = profiles.some((profile) => listsSpace(profile, space.id))
              return (
                <DropdownMenuItem
                  key={space.id}
                  onClick={() =>
                    added
                      ? void navigate({
                          to: "/spaces/$spaceId",
                          params: { spaceId: space.id },
                        })
                      : addition.add(space)
                  }
                >
                  {added ? <IconCheck /> : <IconCube />}
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

export function AddHere(props: { app: App; space: Target; onAdded: Added }) {
  const addition = useAddition(props.app, props.onAdded)
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground"
        aria-label={`Add ${props.app.name} to ${props.space.name}`}
        onClick={() => addition.add(props.space)}
      >
        <IconPlus />
      </Button>
      {addition.dialog}
    </>
  )
}

function ChooseProfile(props: {
  app: App
  space: Target
  shared: ReadonlyArray<AppProfile>
  onUse: (profile: AppProfile) => void
  onCreate: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Add {props.app.name} to {props.space.name}
          </DialogTitle>
          <DialogDescription>Use an account already connected, or connect a new one for this space.</DialogDescription>
        </DialogHeader>
        <Rows>
          {[
            ...props.shared.map((profile) => (
              <Row key={profile.id} title={profile.name} description={reach(profile)}>
                <Button variant="outline" size="sm" onClick={() => props.onUse(profile)}>
                  Use
                </Button>
              </Row>
            )),
            <Row key="new" title={`New account for ${props.space.name}`} description="Only this space uses it.">
              <Button size="sm" onClick={props.onCreate}>
                Create
              </Button>
            </Row>,
          ]}
        </Rows>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
