import { useState } from "react"
import type { ChannelInstallInfo, ChannelMappingCreateInput, ChannelMappingInfo } from "@ren/client"
import { useMutation, useQueries, useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconAt, IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChannelMark } from "@/components/ren/channel-mark"
import { EmptyState } from "@/components/ren/empty-state"
import { ListPagination } from "@/components/ren/list-pagination"
import { TableCard, TableEmpty } from "@/components/ren/page"
import { RowMenu } from "@/components/ren/row-menu"
import { api, errorMessage, pageSize } from "@/lib/api"
import { Channels } from "@/lib/channels"
import { currentPage, pageCount } from "@/lib/pagination"
import { useSpace } from "@/routes/space/use-space"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/channels")

function useSpaceChannels() {
  const space = useSpace()
  const search = route.useSearch()
  const mappings = useSuspenseQuery(api["channel-mapping"].list.queryOptions({ ...Channels.all, spaceId: space.id }))
    .data.items
  const installs = useSuspenseQuery(Channels.installsOptions()).data.items
  const create = useMutation({ ...api["channel-mapping"].create.mutationOptions(), meta: Channels.changed })
  const remove = useMutation({ ...api["channel-mapping"].remove.mutationOptions(), meta: Channels.changed })
  const [adding, setAdding] = useState(false)
  const page = Math.min(currentPage(search), pageCount(mappings.length, pageSize))
  return {
    space,
    canLink: space.membershipId !== null || space.canUpdate,
    mappings,
    installs,
    page,
    visible: mappings.slice((page - 1) * pageSize, page * pageSize),
    adding,
    open: (next: boolean) => {
      create.reset()
      setAdding(next)
    },
    saving: create.isPending,
    error: create.error,
    add: (picked: ReadonlyArray<ChannelMappingCreateInput>) =>
      Promise.all(picked.map((input) => create.mutateAsync({ ...input, spaceId: space.id }))).then(() => {
        toast.success(picked.length > 1 ? `${picked.length} channels linked` : "Channel linked")
        setAdding(false)
      }),
    unlink: (mapping: ChannelMappingInfo) =>
      remove.mutateAsync(
        { id: mapping.id },
        {
          onSuccess: () => toast.success(`${Channels.label(mapping.provider, mapping.placeName)} unlinked`),
          onError: (error) => toast.error("Couldn’t unlink the channel", { description: errorMessage(error) }),
        },
      ),
  }
}

export function SpaceChannelsTab() {
  const page = useSpaceChannels()
  return (
    <div className="flex flex-col gap-4">
      {page.canLink ? (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" onClick={() => page.open(true)}>
            <IconPlus data-icon="inline-start" />
            Add channel
          </Button>
        </div>
      ) : null}
      <TableCard>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead className="w-2/5">Provider</TableHead>
              {page.canLink ? <TableHead className="w-15" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.visible.length === 0 ? (
              <TableEmpty columns={3}>No channels yet. Link one so people can mention @Ren there.</TableEmpty>
            ) : null}
            {page.visible.map((mapping) => {
              const name = Channels.label(mapping.provider, mapping.placeName)
              return (
                <TableRow key={mapping.id}>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ChannelMark provider={mapping.provider} className="size-4 shrink-0" />
                      <span className="truncate">{name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{Channels.byId[mapping.provider].title}</TableCell>
                  {page.canLink ? (
                    <TableCell>
                      <RowMenu
                        label={`${name} actions`}
                        items={[
                          {
                            label: "Unlink",
                            onSelect: () => page.unlink(mapping),
                            confirm: {
                              title: `Unlink ${name}?`,
                              description: `Mentions of @Ren there stop reaching ${page.space.name}.`,
                              action: "Unlink",
                            },
                          },
                        ]}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableCard>
      <div className="flex items-center justify-between gap-4 empty:hidden">
        <ListPagination page={page.page} pageSize={pageSize} total={page.mappings.length} noun="channel" />
      </div>
      {page.adding ? (
        <AddChannelsDialog
          spaceId={page.space.id}
          installs={page.installs}
          saving={page.saving}
          error={page.error}
          onAdd={page.add}
          onClose={() => page.open(false)}
        />
      ) : null}
    </div>
  )
}

function AddChannelsDialog(props: {
  spaceId: string
  installs: ReadonlyArray<ChannelInstallInfo>
  saving: boolean
  error: Error | null
  onAdd: (picked: ReadonlyArray<ChannelMappingCreateInput>) => Promise<void>
  onClose: () => void
}) {
  const places = useQueries({
    queries: props.installs.map((install) => Channels.placesOptions(install.id)),
  })
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const groups = props.installs.map((install, index) => ({
    install,
    places: (places[index]?.data?.items ?? []).filter((place) => place.mapping?.space.id !== props.spaceId),
  }))
  const chosen = groups.flatMap((group) =>
    group.places.flatMap((place) =>
      picked.has(`${group.install.id} ${place.id}`)
        ? [
            place.mapping
              ? Channels.settingsOf(place.mapping)
              : { installId: group.install.id, place: place.id, spaceId: props.spaceId },
          ]
        : [],
    ),
  )
  const failed = places.find((query) => query.error)?.error
  const connected = props.installs.length > 0
  return (
    <Dialog open onOpenChange={(open) => (open || props.saving ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add channels</DialogTitle>
          <DialogDescription>
            People can mention @Ren in these channels to start a chat in this space.
          </DialogDescription>
        </DialogHeader>
        {connected ? (
          <Command className="rounded-lg! bg-muted inset-ring inset-ring-border **:data-[slot=input-group]:h-8.75!">
            <CommandInput placeholder="Search channels…" />
            <CommandList className="pt-1">
              <CommandEmpty>
                {places.some((query) => query.isPending)
                  ? "Loading…"
                  : failed
                    ? errorMessage(failed, "Could not list the channels.")
                    : "No channels to add"}
              </CommandEmpty>
              {groups.map((group) =>
                group.places.length > 0 ? (
                  <CommandGroup
                    key={group.install.id}
                    heading={`${Channels.byId[group.install.provider].title} · ${group.install.name}`}
                    className="p-0"
                  >
                    {group.places.map((place) => {
                      const key = `${group.install.id} ${place.id}`
                      return (
                        <CommandItem
                          key={key}
                          value={key}
                          keywords={[place.name]}
                          onSelect={() =>
                            setPicked((current) =>
                              current.has(key)
                                ? new Set([...current].filter((each) => each !== key))
                                : new Set([...current, key]),
                            )
                          }
                        >
                          <Checkbox
                            checked={picked.has(key)}
                            tabIndex={-1}
                            aria-hidden
                            className="pointer-events-none"
                          />
                          <span className="flex-1 truncate">{Channels.label(group.install.provider, place.name)}</span>
                          {place.mapping ? (
                            <span className="truncate text-xs text-muted-foreground">{place.mapping.space.name}</span>
                          ) : null}
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                ) : null,
              )}
            </CommandList>
          </Command>
        ) : (
          <EmptyState
            action={
              <Button variant="outline" nativeButton={false} render={<Link to="/settings/channels" />}>
                <IconAt data-icon="inline-start" />
                Open Mentions settings
              </Button>
            }
          >
            Connect Slack, GitHub or Linear first.
          </EmptyState>
        )}
        {props.error ? <FieldError>{errorMessage(props.error)}</FieldError> : null}
        <DialogFooter className={connected ? undefined : "sm:justify-end"}>
          <DialogClose render={<Button variant="outline" />} disabled={props.saving}>
            Cancel
          </DialogClose>
          {connected ? (
            <Button
              disabled={chosen.length === 0 || props.saving}
              onClick={() => void props.onAdd(chosen).catch(() => undefined)}
            >
              {props.saving ? <Spinner data-icon="inline-start" /> : null}
              {chosen.length > 1 ? `Add ${chosen.length} channels` : "Add channel"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
