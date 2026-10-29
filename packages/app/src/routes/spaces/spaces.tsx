import { useState } from "react"
import type { SpaceInfo } from "@ren/client"
import { IconCube, IconEye, IconLogin2, IconPlus } from "@tabler/icons-react"
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
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
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
import { Spinner } from "@/components/ui/spinner"
import { pageSize } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useSpacesPage } from "@/routes/spaces/use-spaces-page"
import { formText } from "@/lib/format"
import { SpaceCard } from "@/routes/spaces/space-card"

const isPrivate = (space: SpaceInfo) => space.kind === "private"

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
      <div
        className={cn(
          "mt-4 grid gap-4 transition-opacity sm:grid-cols-2",
          page.stale && "opacity-60",
          !page.spaces && "hidden",
        )}
      >
        {(page.spaces ?? [])
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
            <Command className="rounded-none! bg-transparent p-0 **:data-[slot=command-input-wrapper]:mx-0 **:data-[slot=command-input-wrapper]:mt-0">
              <CommandInput placeholder="Search spaces…" />
              <CommandList className="pt-1">
                <CommandEmpty>{props.loading ? "Loading…" : "No matching spaces"}</CommandEmpty>
                <CommandGroup className="p-0">
                  {joinable.map((space) => (
                    <CommandItem
                      key={space.id}
                      value={`${space.name} ${space.id}`}
                      data-checked={selected === space.id || undefined}
                      onSelect={() => setSelected(space.id)}
                      className="items-start py-1.5"
                    >
                      <IconCube className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <span className="flex min-w-0 flex-col">
                        {space.name}
                        {space.description ? (
                          <span className="truncate text-xs text-muted-foreground">{space.description}</span>
                        ) : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
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
