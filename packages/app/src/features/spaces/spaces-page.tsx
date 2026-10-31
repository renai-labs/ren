import type { SpaceInfo } from "@ren/client"
import { IconCube, IconEye, IconLogin2, IconPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Textarea } from "@ren/ui/textarea"
import { FilterMenu, passes, type Filters } from "../../components/filter-menu.js"
import { ExpandableSearch } from "../../components/expandable-search.js"
import { Page, SkeletonCards } from "../../components/page.js"
import { ListPagination } from "../../components/list-pagination.js"
import { Spinner } from "@ren/ui/spinner"
import { pageSize, pickerPageSize, currentPage } from "../../lib/pagination.js"
import { cn } from "cn"
import { formText } from "../../lib/format.js"
import { SpaceCard } from "./space-card.js"
import { useState } from "react"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { toast } from "@ren/ui/sonner"
import { useMe } from "../../lib/use-me.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

const route = getRouteApi("/_authed/_shell/spaces/")

const isPrivate = (space: SpaceInfo) => space.kind === "private"

export function SpacesPage() {
  const { api } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = useNavigate()
  const me = useMe()
  const page = currentPage(search)
  const list = useQuery({
    ...api.space.list.queryOptions({ page, pageSize }),
    placeholderData: keepPreviousData,
    ...Loader.required,
  })
  const [dialog, setDialog] = useState<"create" | "join" | null>(null)
  const joinable = useQuery({
    ...api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }),
    enabled: dialog === "join",
    select: (data) => data.items.filter((space) => space.membershipId === null),
  })
  const create = useMutation(api.space.create.mutationOptions())
  const join = useMutation(api["space-member"].create.mutationOptions())
  const spaces = list.data?.items
  const total = list.data?.total ?? 0
  const stale = list.isPlaceholderData
  const joinableLoading = joinable.isPending
  const creating = create.isPending
  const joining = join.isPending
  const createSpace = (input: { name: string; description: string }) =>
    create.mutate(
      { name: input.name, ...(input.description && { description: input.description }) },
      {
        onSuccess: (space) => {
          setDialog(null)
          toast.success(`Created ${space.name}`)
          void navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } })
        },
        onError: (error) => toast.error("Could not create the space", { description: errorMessage(error) }),
      },
    )
  const joinSpace = (spaceId: string, name: string) =>
    join.mutate(
      { payload: { spaceId, userId: me.user.id } },
      {
        onSuccess: () => {
          setDialog(null)
          toast.success(`Joined ${name}`)
          void navigate({ to: "/spaces/$spaceId", params: { spaceId } })
        },
        onError: (error) => toast.error("Could not join the space", { description: errorMessage(error) }),
      },
    )
  const [filters, setFilters] = useState<Filters>({})
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  return (
    <Page
      title="Spaces"
      description="Each space gives a team its own credentials, apps and agents."
      actions={
        <>
          <ExpandableSearch label="Search spaces" value={query} onChange={setQuery} />
          <FilterMenu
            label="Filter spaces"
            properties={[
              {
                key: "visibility",
                label: "Visibility",
                any: "All spaces",
                icon: IconEye,
                single: true,
                options: [
                  { value: "shared", label: "Shared" },
                  { value: "private", label: "Private" },
                ],
              },
            ]}
            value={filters}
            onChange={setFilters}
          />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button />}>
              <IconPlus data-icon="inline-start" />
              New space
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setDialog("create")}>
                  <IconPlus />
                  Create space
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("join")}>
                  <IconLogin2 />
                  Join space
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <NewSpaceDialog
            open={dialog === "create"}
            pending={creating}
            onOpenChange={(open) => setDialog(open ? "create" : null)}
            onCreate={(name, description) => createSpace({ name, description })}
          />
          <JoinSpaceDialog
            open={dialog === "join"}
            spaces={joinable.data ?? []}
            loading={joinableLoading}
            pending={joining}
            onOpenChange={(open) => setDialog(open ? "join" : null)}
            onJoin={joinSpace}
          />
        </>
      }
      footer={<ListPagination page={page} pageSize={pageSize} total={total} noun="space" />}
    >
      {spaces ? null : <SkeletonCards />}
      <div
        className={cn("mt-4 grid gap-4 transition-opacity sm:grid-cols-2", stale && "opacity-60", !spaces && "hidden")}
      >
        {(spaces ?? [])
          .filter((space) => !needle || `${space.name} ${space.description ?? ""}`.toLowerCase().includes(needle))
          .filter((space) =>
            passes(filters, {
              visibility: [isPrivate(space) ? "private" : "shared"],
            }),
          )
          .map((space) => (
            <SpaceCard key={space.id} space={space} />
          ))}
      </div>
    </Page>
  )
}

function NewSpaceDialog(props: {
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string, description: string) => void
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            props.onCreate(formText(form, "name").trim(), formText(form, "description").trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>New space</DialogTitle>
            <DialogDescription>You join it as its first member.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="space-name">Name</FieldLabel>
              <Input id="space-name" name="name" required placeholder="My space" />
            </Field>
            <Field>
              <FieldLabel htmlFor="space-description">
                Description
                <span className="text-xs font-normal text-muted-foreground">Optional</span>
              </FieldLabel>
              <Textarea
                id="space-description"
                name="description"
                placeholder="What does this space work on?"
                className="min-h-20"
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="sm:justify-end">
            <Button type="submit" disabled={props.pending}>
              {props.pending ? <Spinner data-icon="inline-start" /> : null}
              Create space
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function JoinableSpaces(props: {
  spaces: ReadonlyArray<SpaceInfo>
  selected: string | undefined
  onSelect: (spaceId: string) => void
}) {
  return (
    <CommandGroup className="p-0">
      {props.spaces.map((space) => (
        <CommandItem
          key={space.id}
          value={`${space.name} ${space.id}`}
          data-checked={props.selected === space.id || undefined}
          onSelect={() => props.onSelect(space.id)}
          className="items-start py-1.5"
        >
          <IconCube className="mt-0.5 text-muted-foreground" strokeWidth={1.75} />
          <span className="flex min-w-0 flex-col">
            {space.name}
            {space.description ? (
              <span className="truncate text-xs text-muted-foreground">{space.description}</span>
            ) : null}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function JoinSpaceDialog(props: {
  open: boolean
  spaces: ReadonlyArray<SpaceInfo>
  loading: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onJoin: (spaceId: string, name: string) => void
}) {
  const [selected, setSelected] = useState<string>()
  const joinable = props.spaces
  const chosen = joinable.find((space) => space.id === selected)
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join space</DialogTitle>
          <DialogDescription>
            {!props.loading && joinable.length === 0
              ? "You’re already in every space."
              : "Choose a space in your organization to join."}
          </DialogDescription>
        </DialogHeader>
        {!props.loading && joinable.length === 0 ? (
          <DialogFooter className="border-t-0 sm:justify-end">
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        ) : (
          <>
            <Command className="rounded-none bg-transparent p-0 **:data-[slot=command-input-wrapper]:mx-0 **:data-[slot=command-input-wrapper]:mt-0">
              <CommandInput placeholder="Search spaces…" />
              <CommandList className="pt-1">
                <CommandEmpty>{props.loading ? "Loading…" : "No matching spaces"}</CommandEmpty>
                <JoinableSpaces spaces={joinable} selected={selected} onSelect={setSelected} />
              </CommandList>
            </Command>
            <DialogFooter className="border-t-0 sm:justify-end">
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <Button
                disabled={!chosen || props.pending}
                onClick={() => chosen && props.onJoin(chosen.id, chosen.name)}
              >
                {props.pending ? <Spinner data-icon="inline-start" /> : null}
                Join space
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
