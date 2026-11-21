import { useState } from "react"
import type { ChannelInstallInfo, ChannelMappingCreateInput, ChannelMappingInfo, ChannelPlaceInfo } from "@ren/client"
import { useMutation, useQueries, useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconAt, IconChevronRight, IconLinkOff, IconLock, IconPlus } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { cn } from "cn"
import { Button, buttonVariants } from "@ren/ui/button"
import { Checkbox } from "@ren/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { FieldError } from "@ren/ui/field"
import { Spinner } from "@ren/ui/spinner"
import { Tabs } from "@ren/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { ChannelMark } from "../../components/channel-mark.js"
import { PlaceName } from "../../components/place-name.js"
import { EmptyState } from "../../components/empty-state.js"
import { LoadMore } from "../../components/load-more.js"
import { PageActions, PageTabsList, PageTabsTrigger, TableCard, TableEmpty } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { errorMessage } from "../../lib/errors.js"
import { Search } from "@ren/util/search"
import { useShown } from "../../lib/use-shown.js"
import { Channels } from "../../lib/channels.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

function ChannelName(props: { provider: Channels.Provider; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <ChannelMark provider={props.provider} className="size-4 shrink-0" />
      <span className="truncate">{props.name}</span>
    </span>
  )
}

export function SpaceChannelsTab() {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const mappings = useSuspenseQuery(api["channel-mapping"].list.queryOptions({ ...Channels.all, spaceId: space.id }))
    .data.items
  const installs = useSuspenseQuery(Channels.installsOptions(api)).data.items
  const create = useMutation({ ...api["channel-mapping"].create.mutationOptions() })
  const remove = useMutation({ ...api["channel-mapping"].remove.mutationOptions() })
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState("")
  const shown = useShown(
    mappings.filter((mapping) =>
      Search.matches(query, Channels.label(mapping.provider, mapping.placeName), Channels.byId[mapping.provider].title),
    ),
  )
  const canLink = space.membershipId !== null || space.canUpdate
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
    <div className="flex flex-1 flex-col gap-4">
      <PageActions>
        <ToolbarSearch label="Search channels" value={query} onChange={setQuery} />
        {canLink ? (
          <Button onClick={() => open(true)}>
            <IconPlus data-icon="inline-start" />
            Add channel
          </Button>
        ) : null}
      </PageActions>
      <TableCard>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              {canLink ? (
                <TableHead className="w-15">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.items.length === 0 ? (
              <TableEmpty columns={canLink ? 2 : 1}>
                {Search.empty(query, "No channels yet. Link one so people can mention @Ren there.")}
              </TableEmpty>
            ) : null}
            {shown.items.map((mapping) => {
              const name = Channels.label(mapping.provider, mapping.placeName)
              return (
                <TableRow key={mapping.id}>
                  <TableCell>
                    <ChannelName provider={mapping.provider} name={name} />
                  </TableCell>
                  {canLink ? (
                    <TableCell>
                      <RowMenu
                        label={`${name} actions`}
                        items={[
                          {
                            label: "Unlink",
                            icon: IconLinkOff,
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
      <LoadMore more={shown.more} onMore={shown.next} />
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

const flatCommand =
  "rounded-none bg-transparent p-0 **:data-[slot=command-input-wrapper]:mx-0 **:data-[slot=command-input-wrapper]:mt-0"

function PlaceRow(props: {
  provider: Channels.Provider
  place: ChannelPlaceInfo
  value: string
  picked: boolean
  onToggle: () => void
}) {
  return (
    <CommandItem value={props.value} keywords={[props.place.name]} onSelect={props.onToggle}>
      <Checkbox checked={props.picked} tabIndex={-1} aria-hidden className="pointer-events-none" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 break-words">
          <PlaceName provider={props.provider} name={props.place.name} />
          <span className="sr-only">{props.picked ? ", selected" : ""}</span>
        </span>
        {props.place.private ? (
          <IconLock aria-label="Private" className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </span>
      {props.place.mapping ? (
        <span className={cn("shrink-0 text-xs", props.picked ? "text-foreground" : "text-muted-foreground")}>
          {props.picked ? `Moves from ${props.place.mapping.space.name}` : props.place.mapping.space.name}
        </span>
      ) : null}
    </CommandItem>
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
  const [tab, setTab] = useState(props.installs[0]?.id ?? "")
  const [query, setQuery] = useState("")
  const [others, setOthers] = useState(false)
  const groups = props.installs.map((install, index) => {
    const listed = (places[index]?.data?.items ?? []).filter((place) => place.mapping?.space.id !== props.spaceId)
    return {
      install,
      query: places[index],
      free: listed.filter((place) => !place.mapping),
      taken: listed.filter((place) => place.mapping),
    }
  })
  const group = groups.find((each) => each.install.id === tab) ?? groups[0]
  const keyOf = (installId: string, placeId: string) => `${installId} ${placeId}`
  const toggle = (key: string) =>
    setPicked((current) =>
      current.has(key) ? new Set([...current].filter((each) => each !== key)) : new Set([...current, key]),
    )
  const chosen = groups.flatMap((each) =>
    [...each.free, ...each.taken].flatMap((place) =>
      picked.has(keyOf(each.install.id, place.id))
        ? [
            place.mapping
              ? Channels.settingsOf(place.mapping)
              : { installId: each.install.id, place: place.id, spaceId: props.spaceId },
          ]
        : [],
    ),
  )
  const moving = groups.flatMap((each) =>
    each.taken.flatMap((place) =>
      place.mapping && picked.has(keyOf(each.install.id, place.id))
        ? [`${Channels.label(each.install.provider, place.name)} will stop reaching ${place.mapping.space.name}.`]
        : [],
    ),
  )
  const provider = group ? Channels.byId[group.install.provider] : undefined
  const pickedIn = (installId: string) => [...picked].filter((key) => key.startsWith(`${installId} `)).length
  const kinds = [
    ...new Set(groups.filter((each) => pickedIn(each.install.id) > 0).map((each) => each.install.provider)),
  ]
  const only = kinds.length === 1 && kinds[0] ? Channels.byId[kinds[0]] : undefined
  const kind = only ?? (kinds.length === 0 && provider ? provider : Channels.byId.slack)
  const addLabel = chosen.length > 1 ? `Add ${chosen.length} ${kind.plural}` : `Add ${kind.noun}`
  const showOthers = others || query.trim() !== ""
  const empty = () => {
    if (!group || !provider) return null
    if (group.query?.isPending) return "Loading…"
    if (group.query?.error) return errorMessage(group.query.error, `Couldn’t list the ${provider.plural}.`)
    if (group.free.length + group.taken.length === 0) return `Every ${provider.noun} is already in this space.`
    if (group.free.length === 0 && !query.trim()) return `The other ${provider.plural} are in other spaces.`
    return `No matching ${provider.plural}.`
  }
  return (
    <Dialog open onOpenChange={(open) => (open || props.saving ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add channels</DialogTitle>
        </DialogHeader>
        {group && provider ? (
          <div className="flex flex-col gap-3">
            {groups.length > 1 ? (
              <Tabs
                value={group.install.id}
                onValueChange={(value: string) => {
                  setTab(value)
                  setQuery("")
                  setOthers(false)
                }}
              >
                <PageTabsList aria-label="Provider">
                  {groups.map((each) => (
                    <PageTabsTrigger
                      key={each.install.id}
                      value={each.install.id}
                      count={pickedIn(each.install.id) || undefined}
                    >
                      <ChannelMark provider={each.install.provider} className="size-4" />
                      {Channels.byId[each.install.provider].title}
                    </PageTabsTrigger>
                  ))}
                </PageTabsList>
              </Tabs>
            ) : null}
            <Command key={group.install.id} className={flatCommand}>
              <CommandInput value={query} onValueChange={setQuery} placeholder={`Search ${provider.plural}…`} />
              <CommandList className="h-72 pt-1">
                <CommandEmpty>{empty()}</CommandEmpty>
                {group.free.length > 0 ? (
                  <CommandGroup className="p-0">
                    {group.free.map((place) => {
                      const key = keyOf(group.install.id, place.id)
                      return (
                        <PlaceRow
                          key={key}
                          value={key}
                          provider={group.install.provider}
                          place={place}
                          picked={picked.has(key)}
                          onToggle={() => toggle(key)}
                        />
                      )
                    })}
                  </CommandGroup>
                ) : null}
                {group.taken.length > 0 && !query.trim() ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={showOthers}
                    className="mt-1 text-muted-foreground"
                    onClick={() => setOthers((was) => !was)}
                  >
                    In other spaces · {group.taken.length}
                    <IconChevronRight
                      data-icon="inline-end"
                      className={showOthers ? "rotate-90 transition-transform" : "transition-transform"}
                    />
                  </Button>
                ) : null}
                {group.taken.length > 0 && showOthers ? (
                  <CommandGroup className="p-0">
                    {group.taken.map((place) => {
                      const key = keyOf(group.install.id, place.id)
                      return (
                        <PlaceRow
                          key={key}
                          value={key}
                          provider={group.install.provider}
                          place={place}
                          picked={picked.has(key)}
                          onToggle={() => toggle(key)}
                        />
                      )
                    })}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
            <p className="text-xs text-muted-foreground">
              {group.install.provider === "slack" ? (
                <>
                  Missing a channel? Run <code>/invite @Ren</code> in it.
                </>
              ) : (
                "Missing a repo? Give the Ren app access to it on GitHub."
              )}
            </p>
          </div>
        ) : (
          <EmptyState
            action={
              <Link to="/settings/channels" className={buttonVariants({ variant: "outline" })}>
                <IconAt data-icon="inline-start" />
                Open channel settings
              </Link>
            }
          >
            Connect Slack or GitHub first.
          </EmptyState>
        )}
        <p role="status" className="sr-only">
          {moving.join(" ")}
        </p>
        {props.error ? <FieldError>{errorMessage(props.error)}</FieldError> : null}
        <DialogFooter className={group ? undefined : "sm:justify-end"}>
          <DialogClose render={<Button variant="outline" />} disabled={props.saving}>
            Cancel
          </DialogClose>
          {group ? (
            <Button
              disabled={chosen.length === 0 || props.saving}
              onClick={() => void props.onAdd(chosen).catch(() => undefined)}
            >
              {props.saving ? <Spinner data-icon="inline-start" /> : null}
              {addLabel}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
