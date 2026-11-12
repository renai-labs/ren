import type { SpaceInfo } from "@ren/client"
import { IconCube, IconEye, IconLock, IconLogin2, IconPlus, IconUsers } from "@tabler/icons-react"
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
import { FilterMenu, passes, type Filters } from "../../components/filter-menu.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { CardsSample, Page, useShapeId } from "../../components/page.js"
import { LoadMore } from "../../components/load-more.js"
import { Loading } from "@ren/ui/loading"
import { Spinner } from "@ren/ui/spinner"
import { pageSize, pickerPageSize } from "../../lib/pagination.js"
import { Pages } from "../../lib/pages.js"
import { NewSpaceDialog } from "../../components/new-space-dialog.js"
import { SpaceCard } from "./space-card.js"
import { useState } from "react"
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "@ren/ui/sonner"
import { useMe } from "../../lib/use-me.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

const isPrivate = (space: SpaceInfo) => space.kind === "private"

export function SpacesPage() {
  const { api, client, queryClient } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const me = useMe()
  const pickerKey = api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }).queryKey
  const list = useInfiniteQuery({
    ...Pages.spaces(client),
    initialData: () => {
      const picked = queryClient.getQueryData(pickerKey)
      return picked && picked.total <= picked.items.length
        ? { pages: [{ ...picked, pageSize, items: picked.items.slice(0, pageSize) }], pageParams: [1] }
        : undefined
    },
    initialDataUpdatedAt: () => queryClient.getQueryState(pickerKey)?.dataUpdatedAt,
    ...Loader.required,
  })
  const shapeId = useShapeId("spaces")
  const [dialog, setDialog] = useState<"create" | "join" | null>(null)
  const joinable = useQuery({
    ...api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }),
    enabled: dialog === "join",
    select: (data) => data.items.filter((space) => space.membershipId === null),
  })
  const join = useMutation(api["space-member"].create.mutationOptions())
  const spaces = list.data?.pages.flatMap((page) => page.items)
  const joinableLoading = joinable.isPending
  const joining = join.isPending
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
          <ToolbarSearch label="Search spaces" value={query} onChange={setQuery} />
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
                  { value: "shared", label: "Shared", icon: IconUsers },
                  { value: "private", label: "Private", icon: IconLock },
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
          <NewSpaceDialog open={dialog === "create"} onOpenChange={(open) => setDialog(open ? "create" : null)} />
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
    >
      <Loading id={shapeId} loading={!spaces} label="Loading spaces">
        {spaces ? null : <CardsSample />}
        <div className={spaces ? "mt-4 grid gap-5 sm:grid-cols-2" : "hidden"}>
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
      </Loading>
      <LoadMore more={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
    </Page>
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
