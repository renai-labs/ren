import { useState } from "react"
import type { SpaceInfo } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  IconArrowRight,
  IconCube,
  IconEye,
  IconLock,
  IconLogin2,
  IconMessage,
  IconPlus,
  IconUser,
  IconUsers,
} from "@tabler/icons-react"
import { AvatarGroup } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FilterMenu, passes, type Filters } from "@/components/ren/filter-menu"
import { ExpandableSearch } from "@/components/ren/expandable-search"
import { Page, SkeletonCards } from "@/components/ren/page"
import { ListPagination } from "@/components/ren/list-pagination"
import { PersonAvatar } from "@/components/ren/person-avatar"
import { Spinner } from "@/components/ui/spinner"
import { api, pageSize } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useSpacesPage } from "@/routes/spaces/use-spaces-page"
import { formText } from "@/lib/format"

const isPrivate = (space: SpaceInfo) => space.memberCount === 1 && space.membershipId !== null

export function SpacesPage() {
  const page = useSpacesPage()
  const [filters, setFilters] = useState<Filters>({})
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  return (
    <Page
      title="Spaces"
      description="Each space gives a team its own credentials, apps and agents."
      actions={
        <>
          <ExpandableSearch
            label="Search spaces"
            value={query}
            onChange={setQuery}
          />
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
            <DropdownMenuTrigger
              render={
                <Button size="icon-sm" aria-label="Create or join a space" />
              }
            >
              <IconPlus />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => page.openDialog("create")}>
                  <IconPlus />
                  Create space
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => page.openDialog("join")}>
                  <IconLogin2 />
                  Join space
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <NewSpaceDialog
            open={page.dialog === "create"}
            pending={page.creating}
            onOpenChange={(open) => page.openDialog(open ? "create" : null)}
            onCreate={(name, description) => page.createSpace({ name, description })}
          />
          <JoinSpaceDialog
            open={page.dialog === "join"}
            spaces={page.joinable}
            loading={page.joinableLoading}
            pending={page.joining}
            onOpenChange={(open) => page.openDialog(open ? "join" : null)}
            onJoin={page.joinSpace}
          />
        </>
      }
      footer={<ListPagination page={page.page} pageSize={pageSize} total={page.total} noun="space" />}
    >
      {page.spaces ? null : <SkeletonCards />}
      <div className={cn("mt-4 grid gap-4 transition-opacity sm:grid-cols-2", page.stale && "opacity-60", !page.spaces && "hidden")}>
        {(page.spaces ?? [])
          .filter(
            (space) =>
              !needle ||
              `${space.name} ${space.description ?? ""}`
                .toLowerCase()
                .includes(needle)
          )
          .filter((space) =>
            passes(filters, {
              visibility: [
                isPrivate(space) ? "private" : "shared",
              ],
            })
          )
          .map((space) => (
            <SpaceCard key={space.id} space={space} />
          ))}
      </div>
    </Page>
  )
}

function SpaceCard(props: { space: SpaceInfo }) {
  const space = props.space
  const personal = isPrivate(space)
  const chats = useQuery(api.session.list.queryOptions({ spaceId: space.id, page: 1, pageSize: 1 }))
  const people = useQuery({
    ...api["space-member"].list.queryOptions({ spaceId: space.id, status: "active", page: 1, pageSize: 4 }),
    enabled: !personal && space.membershipId !== null,
  })
  const members = (people.data?.items ?? []).flatMap((member) => (member.status === "active" ? [member.name] : []))
  const memberCount = space.memberCount
  const chatCount = chats.data?.total ?? 0
  const shown = memberCount > 4 ? members.slice(0, 3) : members
  return (
    <Card className="relative gap-4 border ring-0 transition-colors [--card-spacing:--spacing(6)] hover:bg-muted active:scale-99">
      <CardHeader>
        <div className="mb-3 flex size-12 items-center justify-center rounded-lg bg-secondary">
          <IconCube className="size-8 text-muted-foreground" strokeWidth={1.75} />
        </div>
        <CardTitle className="text-sm/5">
          <Link to="/spaces/$spaceId" params={{ spaceId: space.id }} className="after:absolute after:inset-0">
            {space.name}
          </Link>
        </CardTitle>
        <CardDescription className="line-clamp-2 text-xs">{space.description || "No description"}</CardDescription>
        <CardAction className="flex items-center gap-2">
          {personal ? (
            <Badge variant="secondary">
              <IconLock />
              Private
            </Badge>
          ) : null}
          <IconArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100" />
        </CardAction>
      </CardHeader>
      <CardFooter className="mx-6 mb-6 gap-6 bg-transparent px-0 pt-3 pb-0 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {personal ? (
            <IconUser className="size-4" />
          ) : members.length === 0 ? (
            <IconUsers className="size-4" />
          ) : (
            <AvatarGroup className="gap-1 space-x-0 *:data-[slot=avatar]:ring-card">
              {shown.map((name) => (
                <PersonAvatar
                  key={name}
                  name={name}
                  className="bg-secondary text-[10px] font-medium text-foreground"
                />
              ))}
              {memberCount > shown.length ? (
                <PersonAvatar
                  name={`+${memberCount - shown.length}`}
                  initials={`+${memberCount - shown.length}`}
                  className="text-[10px]"
                />
              ) : null}
            </AvatarGroup>
          )}
          {personal ? "Just you" : memberCount === 1 ? "1 member" : `${memberCount} members`}
        </span>
        <span className="flex items-center gap-2 tabular-nums">
          <IconMessage className="size-4" />
          {chatCount === 1 ? "1 chat" : `${chatCount} chats`}
        </span>
      </CardFooter>
    </Card>
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
            props.onCreate(
              formText(form, "name").trim(),
              formText(form, "description").trim()
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>New space</DialogTitle>
            <DialogDescription>
              You join it as its first member.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="space-name">Name</FieldLabel>
              <Input
                id="space-name"
                name="name"
                required
                placeholder="My space"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="space-description">
                Description
                <span className="text-xs font-normal text-muted-foreground">
                  Optional
                </span>
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
            Choose a space in your organization to join.
          </DialogDescription>
        </DialogHeader>
        <Command className="rounded-lg! bg-muted inset-ring inset-ring-border **:data-[slot=input-group]:h-8.75!">
          <CommandInput placeholder="Search spaces…" />
          <CommandList className="pt-1">
            <CommandEmpty>
              {props.loading
                ? "Loading…"
                : joinable.length === 0
                  ? "You’re already in every space"
                  : "No matching spaces"}
            </CommandEmpty>
            {joinable.length > 0 ? (
              <CommandGroup heading="Available spaces" className="p-0">
                {joinable.map((space) => (
                  <CommandItem
                    key={space.id}
                    value={`${space.name} ${space.id}`}
                    data-checked={selected === space.id || undefined}
                    onSelect={() => setSelected(space.id)}
                    className="items-start py-1"
                  >
                    <span className="mt-0.5 flex size-5 items-center justify-center rounded-md bg-secondary">
                      <IconCube
                        className="size-4 text-muted-foreground"
                        strokeWidth={1.75}
                      />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      {space.name}
                      {space.description ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {space.description}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            disabled={!chosen || props.pending}
            onClick={() => chosen && props.onJoin(chosen.id, chosen.name)}
          >
            {props.pending ? <Spinner data-icon="inline-start" /> : null}
            Join space
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
