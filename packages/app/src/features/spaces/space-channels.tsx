import { useState } from "react"
import type { ChannelInstallInfo, ChannelMappingCreateInput, ChannelMappingInfo } from "@ren/client"
import { useMutation, useQueries, useSuspenseQuery, type UseQueryResult } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconAt, IconPlus } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button, buttonVariants } from "@ren/ui/button"
import { Checkbox } from "@ren/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { FieldError } from "@ren/ui/field"
import { Spinner } from "@ren/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { ChannelMark } from "../../components/channel-mark.js"
import { EmptyState } from "../../components/empty-state.js"
import { ListPagination } from "../../components/list-pagination.js"
import { TableCard, TableEmpty } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { errorMessage } from "../../lib/errors.js"
import { pageSize, currentPage, pageCount } from "../../lib/pagination.js"
import { Channels } from "../../lib/channels.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/channels")

function ChannelName(props: { provider: Channels.Provider; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <ChannelMark provider={props.provider} className="size-4 shrink-0" />
      <span className="truncate">{props.name}</span>
    </span>
  )
}

function emptyText(places: ReadonlyArray<Pick<UseQueryResult, "isPending">>, failed: Error | null | undefined) {
  if (places.some((query) => query.isPending)) return "Loading…"
  if (failed) return errorMessage(failed, "Could not list the channels.")
  return "No channels to add"
}

export function SpaceChannelsTab() {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const search = route.useSearch()
  const mappings = useSuspenseQuery(api["channel-mapping"].list.queryOptions({ ...Channels.all, spaceId: space.id }))
    .data.items
  const installs = useSuspenseQuery(Channels.installsOptions(api)).data.items
  const create = useMutation({ ...api["channel-mapping"].create.mutationOptions() })
  const remove = useMutation({ ...api["channel-mapping"].remove.mutationOptions() })
  const [adding, setAdding] = useState(false)
  const page = Math.min(currentPage(search), pageCount(mappings.length, pageSize))
  const canLink = space.membershipId !== null || space.canUpdate
  const visible = mappings.slice((page - 1) * pageSize, page * pageSize)
  const open = (next: boolean) => {
    create.reset()
    setAdding(next)
  }
  const saving = create.isPending
  const error = create.error
  const add = (picked: ReadonlyArray<ChannelMappingCreateInput>) =>
    Promise.all(picked.map((input) => create.mutateAsync({ ...input, spaceId: space.id }))).then(() => {
      toast.success(picked.length > 1 ? `${picked.length} channels linked` : "Channel linked")
      setAdding(false)
    })
  const unlink = (mapping: ChannelMappingInfo) =>
    remove.mutateAsync(
      { id: mapping.id },
      {
        onSuccess: () => toast.success(`${Channels.label(mapping.provider, mapping.placeName)} unlinked`),
        onError: (error) => toast.error("Couldn’t unlink the channel", { description: errorMessage(error) }),
      },
    )
  return (
    <div className="flex flex-col gap-4">
      {canLink ? (
        <div className="flex items-center justify-end gap-1">
          <Button onClick={() => open(true)}>
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
              {canLink ? <TableHead className="w-15" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableEmpty columns={3}>No channels yet. Link one so people can mention @Ren there.</TableEmpty>
            ) : null}
            {visible.map((mapping) => {
              const name = Channels.label(mapping.provider, mapping.placeName)
              return (
                <TableRow key={mapping.id}>
                  <TableCell>
                    <ChannelName provider={mapping.provider} name={name} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{Channels.byId[mapping.provider].title}</TableCell>
                  {canLink ? (
                    <TableCell>
                      <RowMenu
                        label={`${name} actions`}
                        items={[
                          {
                            label: "Unlink",
                            onSelect: () => unlink(mapping),
                            confirm: {
                              title: `Unlink ${name}?`,
                              description: `Mentions of @Ren there stop reaching ${space.name}.`,
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
        <ListPagination page={page} pageSize={pageSize} total={mappings.length} noun="channel" />
      </div>
      {adding ? (
        <AddChannelsDialog
          spaceId={space.id}
          installs={installs}
          saving={saving}
          error={error}
          onAdd={add}
          onClose={() => open(false)}
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
  const { api } = RouterContext.useRouterContext()
  const places = useQueries({
    queries: props.installs.map((install) => Channels.placesOptions(api, install.id)),
  })
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
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
          <Command className="rounded-lg bg-muted inset-ring inset-ring-border **:data-[slot=input-group]:h-8.75">
            <CommandInput placeholder="Search channels…" />
            <CommandList className="pt-1">
              <CommandEmpty>{emptyText(places, failed)}</CommandEmpty>
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
              <Link to="/settings/channels" className={buttonVariants({ variant: "outline" })}>
                <IconAt data-icon="inline-start" />
                Open Mentions settings
              </Link>
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
