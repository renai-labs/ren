import { useState } from "react"
import type { ChannelInstallInfo, ChannelMappingInfo, ChannelPlaceInfo, ChannelTrigger, SpaceInfo } from "@ren/client"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconAlertCircle, IconArrowLeft, IconCube, IconLock, IconPlus, IconPlugOff } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Checkbox } from "@ren/ui/checkbox"
import { Field, FieldError, FieldLabel } from "@ren/ui/field"
import { Choice } from "../../components/settings-shared.js"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import { Spinner } from "@ren/ui/spinner"
import { ChannelMark } from "../../components/channel-mark.js"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { EmptyState } from "../../components/empty-state.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { Page, SkeletonRows, TableSample, useShapeId } from "../../components/page.js"
import { Loading } from "@ren/ui/loading"
import { errorMessage } from "../../lib/errors.js"
import { Loader } from "../../lib/loader.js"
import { Channels } from "../../lib/channels.js"
import { FilterMenu, spaceOptions } from "../../components/filter-menu.js"
import { Search } from "@ren/schema/search"
import { useShown } from "../../lib/use-shown.js"
import { LoadMore } from "../../components/load-more.js"
import { PlaceName } from "../../components/place-name.js"
import { MappingsTable } from "./mappings-table.js"
import { MappingDialog } from "./mapping-dialog.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/_authed/_shell/settings/channels/$provider")

export function ChannelProviderPage() {
  const { api, platform } = RouterContext.useRouterContext()
  const params = route.useParams()
  const search = route.useSearch()
  const install = useSuspenseQuery(Channels.installsOptions(api)).data.items.find(
    (each) => each.provider === params.provider,
  )
  const offered = useSuspenseQuery(api["channel-connect"]["channel-provider"].list.queryOptions()).data.items.find(
    (each) => each.id === params.provider,
  )
  const start = useMutation(api["channel-connect"]["channel-install"].start.mutationOptions())
  const remove = useMutation(api["channel-install"].remove.mutationOptions())
  const [disconnecting, setDisconnecting] = useState(false)
  const provider = Channels.byId[params.provider]
  const error = search.error
  const connecting = start.isPending
  const connect = () =>
    start.mutate(
      { provider: provider.id },
      {
        onSuccess: (result) => platform.redirect?.(result.redirectUrl),
        onError: (error) =>
          toast.error(`Couldn’t connect ${provider.title}`, { description: errorMessage(error), duration: Infinity }),
      },
    )
  const disconnect = (id: string) =>
    remove.mutateAsync(
      { id },
      {
        onSuccess: () => toast.success(`${provider.title} disconnected`),
        onError: (error) =>
          toast.error(`Couldn’t disconnect ${provider.title}`, {
            description: errorMessage(error),
            duration: Infinity,
          }),
      },
    )
  return (
    <Page
      title={provider.title}
      description={install ? `${install.name} · Connected` : undefined}
      back={
        <Link
          to="/settings/channels"
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "px-0 text-muted-foreground has-[>svg]:px-0",
          })}
        >
          <IconArrowLeft />
          Back to channels
        </Link>
      }
      media={<ChannelMark provider={provider.id} className="size-8" />}
      menu={
        install?.canUpdate ? (
          <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => setDisconnecting(true)}>
            <IconPlugOff data-icon="inline-start" />
            Disconnect {provider.title}
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <Alert variant="destructive">
          <IconAlertCircle />
          <AlertTitle>Couldn’t install Ren on {provider.title}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {install ? (
        <MappingList key={install.id} install={install} provider={provider} triggers={offered?.triggers ?? []} />
      ) : null}
      {install ? null : (
        <NotInstalled provider={provider} offered={offered !== undefined} connecting={connecting} onConnect={connect} />
      )}
      {install ? (
        <ConfirmDialog
          open={disconnecting}
          onOpenChange={setDisconnecting}
          confirmation={{
            title: `Disconnect ${provider.title}?`,
            description: `This unlinks every ${provider.title} ${provider.noun} from its space, and Ren stops responding there. To use ${provider.title} again, connect it again.`,
            action: `Disconnect ${provider.title}`,
          }}
          onConfirm={() => disconnect(install.id)}
        />
      ) : null}
    </Page>
  )
}

function NotInstalled(props: {
  provider: Channels.Info
  offered: boolean
  connecting: boolean
  onConnect: () => void
}) {
  if (!props.offered) return <EmptyState>{props.provider.title} is not set up on this server.</EmptyState>
  return (
    <EmptyState
      action={
        <Button disabled={props.connecting} onClick={props.onConnect}>
          {props.connecting ? <Spinner data-icon="inline-start" /> : <ChannelMark provider={props.provider.id} />}
          Connect {props.provider.title}
        </Button>
      }
    >
      Connect {props.provider.title} so people can mention @Ren in its {props.provider.plural}.
    </EmptyState>
  )
}

function MappingList(props: {
  install: ChannelInstallInfo
  provider: Channels.Info
  triggers: ReadonlyArray<ChannelTrigger>
}) {
  const { api, client } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const spaces = useQuery({ ...Channels.spacesOptions(client), ...Loader.required })
  const mappings = useQuery(Channels.mappingsOptions(client, props.install.id))
  const shapeId = useShapeId("mappings")
  const remove = useMutation(api["channel-mapping"].remove.mutationOptions())
  const restore = useMutation(api["channel-mapping"].create.mutationOptions())
  const items = mappings.data ?? []
  const selected = items.find((mapping) => mapping.id === search.edit)
  const visible = items.filter(
    (mapping) =>
      (!search.spaces?.length || search.spaces.includes(mapping.space.id)) &&
      Search.matches(search.q ?? "", mapping.placeName, mapping.space.name),
  )
  const shown = useShown(visible)
  const editableSpaces = (spaces.data ?? []).filter((space) => space.membershipId !== null || space.canJoin)
  const close = () => {
    void navigate({
      search: (previous) => ({ ...previous, edit: undefined, add: undefined, place: undefined }),
      replace: true,
    })
  }
  return (
    <>
      <div className="flex flex-col gap-3">
        <MappingToolbar spaces={spaces.data ?? []} disabled={editableSpaces.length === 0} provider={props.provider} />
        {mappings.isError ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertTitle>Couldn’t load linked {props.provider.plural}</AlertTitle>
            <AlertDescription>
              {errorMessage(mappings.error)}
              <Button variant="outline" size="sm" onClick={() => void mappings.refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <Loading id={shapeId} loading={mappings.isPending} label={`Loading linked ${props.provider.plural}`}>
          {mappings.isPending ? <TableSample columns={["Channel", "Space", "Status", ""]} /> : null}
          {mappings.isSuccess ? (
            <MappingsTable
              noun={props.provider.noun}
              plural={props.provider.plural}
              mappings={shown.items}
              filtered={Boolean(search.q || search.spaces)}
              editableSpaceIds={editableSpaces.map((space) => space.id)}
              busy={remove.isPending || restore.isPending}
              onEdit={(id) =>
                void navigate({ search: (previous) => ({ ...previous, edit: id, add: undefined, place: undefined }) })
              }
              onRemove={(mapping) =>
                remove.mutate(
                  { id: mapping.id },
                  {
                    onSuccess: () =>
                      toast.success(`${Channels.label(mapping.provider, mapping.placeName)} unlinked`, {
                        action: {
                          label: "Undo",
                          onClick: () =>
                            restore.mutate(Channels.settingsOf(mapping), {
                              onError: (error) =>
                                toast.error(`Couldn’t link ${mapping.placeName} again`, {
                                  description: errorMessage(error),
                                  duration: Infinity,
                                }),
                            }),
                        },
                      }),
                    onError: (error) =>
                      toast.error(`Couldn’t unlink ${mapping.placeName}`, {
                        description: errorMessage(error),
                        duration: Infinity,
                      }),
                  },
                )
              }
            />
          ) : null}
        </Loading>
        <LoadMore more={shown.more} onMore={shown.next} />
      </div>
      {search.add && mappings.isSuccess ? (
        <AddMappingDialog
          install={props.install}
          provider={props.provider}
          spaces={editableSpaces}
          mappings={items}
          onClose={close}
        />
      ) : null}
      {selected ? (
        <MappingDialog
          key={selected.id}
          install={props.install}
          place={{ id: selected.place, name: selected.placeName }}
          mapping={selected}
          spaces={editableSpaces}
          triggers={props.triggers}
          onClose={close}
        />
      ) : null}
    </>
  )
}

function MappingToolbar(props: { spaces: ReadonlyArray<SpaceInfo>; disabled: boolean; provider: Channels.Info }) {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  return (
    <div className="flex min-h-8 items-center justify-end gap-1">
      <ToolbarSearch
        label={`Search ${props.provider.plural}`}
        value={search.q ?? ""}
        onChange={(q) =>
          void navigate({
            search: (previous) => ({ ...previous, q: q || undefined }),
            replace: true,
          })
        }
      />
      <FilterMenu
        label={`Filter ${props.provider.plural}`}
        properties={[
          {
            key: "space",
            label: "Space",
            any: "All spaces",
            icon: IconCube,
            options: spaceOptions(props.spaces),
          },
        ]}
        value={{ space: [...(search.spaces ?? [])] }}
        onChange={(value) =>
          void navigate({
            search: (previous) => ({
              ...previous,
              spaces: value.space?.length ? value.space : undefined,
            }),
            replace: true,
          })
        }
      />
      <Button
        disabled={props.disabled}
        onClick={() =>
          void navigate({ search: (previous) => ({ ...previous, add: true, edit: undefined, place: undefined }) })
        }
      >
        <IconPlus data-icon="inline-start" />
        Add {props.provider.noun}
      </Button>
    </div>
  )
}

const flatCommand =
  "rounded-none bg-transparent p-0 **:data-[slot=command-input-wrapper]:mx-0 **:data-[slot=command-input-wrapper]:mt-0"

function PlaceLabel(props: { provider: Channels.Provider; place: ChannelPlaceInfo; picked: boolean }) {
  return (
    <>
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
    </>
  )
}

function AddMappingDialog(props: {
  install: ChannelInstallInfo
  provider: Channels.Info
  spaces: ReadonlyArray<SpaceInfo>
  mappings: ReadonlyArray<ChannelMappingInfo>
  onClose: () => void
}) {
  const { api, client } = RouterContext.useRouterContext()
  const places = useQuery(Channels.availablePlacesOptions(client, props.install.id))
  const create = useMutation(api["channel-mapping"].create.mutationOptions())
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [spaceId, setSpaceId] = useState("")
  const free = (places.data ?? []).filter((place) => !props.mappings.some((mapping) => mapping.place === place.id))
  const count = picked.size
  const noun = count > 1 ? `${count} ${props.provider.plural}` : props.provider.noun
  const toggle = (id: string) =>
    setPicked((current) =>
      current.has(id) ? new Set([...current].filter((each) => each !== id)) : new Set([...current, id]),
    )
  const link = () =>
    Promise.all(
      [...picked].map((place) =>
        create.mutateAsync({ installId: props.install.id, place, spaceId, fallback: false, triggers: [] }),
      ),
    ).then(() => {
      toast.success(
        `${count > 1 ? `${count} ${props.provider.plural}` : `${props.provider.title} ${props.provider.noun}`} linked`,
      )
      props.onClose()
    })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {props.provider.plural}</DialogTitle>
          {props.provider.id === "slack" ? (
            <DialogDescription>
              Missing a channel? Run <code>/invite @Ren</code> in it.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {places.isError ? (
          <p className="flex items-center gap-3 text-sm text-destructive">
            {errorMessage(places.error)}
            <Button variant="outline" size="sm" onClick={() => void places.refetch()}>
              Retry
            </Button>
          </p>
        ) : null}
        {places.isPending ? <SkeletonRows count={4} label={`Loading ${props.provider.plural}`} /> : null}
        {places.isSuccess ? (
          <Command className={flatCommand}>
            <CommandInput
              aria-label={`Search ${props.provider.plural}`}
              placeholder={`Search ${props.provider.plural}…`}
            />
            <CommandList className="pt-1">
              <CommandEmpty>
                {free.length === 0
                  ? `Every ${props.provider.noun} is already linked.`
                  : `No matching ${props.provider.plural}.`}
              </CommandEmpty>
              <CommandGroup className="p-0">
                {free.map((place) => (
                  <CommandItem
                    key={place.id}
                    value={place.id}
                    keywords={[place.name]}
                    onSelect={() => toggle(place.id)}
                  >
                    <PlaceLabel provider={props.provider.id} place={place} picked={picked.has(place.id)} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : null}
        <Field>
          <FieldLabel>Space</FieldLabel>
          <Choice
            label="Space"
            value={spaceId}
            options={[
              { value: "", label: "Choose a space" },
              ...props.spaces.map((space) => ({ value: space.id, label: space.name })),
            ]}
            className="w-full"
            disabled={create.isPending}
            onChange={setSpaceId}
          />
        </Field>
        {create.isError ? <FieldError>{errorMessage(create.error, "Couldn’t link. Try again.")}</FieldError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={create.isPending}>
            Cancel
          </DialogClose>
          <Button
            disabled={count === 0 || !spaceId || create.isPending}
            onClick={() => void link().catch(() => undefined)}
          >
            {create.isPending ? <Spinner data-icon="inline-start" /> : null}
            Link {noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
