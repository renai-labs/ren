import { useState } from "react"
import type { ChannelInstallInfo, ChannelMappingInfo, ChannelTrigger, SpaceInfo } from "@ren/client"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconAlertCircle, IconArrowLeft, IconCube, IconPlus, IconPlugOff } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import { Spinner } from "@ren/ui/spinner"
import { ChannelMark } from "../../components/channel-mark.js"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { EmptyState } from "../../components/empty-state.js"
import { ExpandableSearch } from "../../components/expandable-search.js"
import { Page, SkeletonRows } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { Loader } from "../../lib/loader.js"
import { Channels } from "../../lib/channels.js"
import { FilterMenu } from "../../components/filter-menu.js"
import { currentPage, pageCount, pageSize } from "../../lib/pagination.js"
import { ListPagination } from "../../components/list-pagination.js"
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
          Back to @mentions
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
            description: `This removes every ${provider.title} mapping for this organization. Ren will stop responding there. You’ll need to connect ${provider.title} again to use it.`,
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
  const remove = useMutation(api["channel-mapping"].remove.mutationOptions())
  const restore = useMutation(api["channel-mapping"].create.mutationOptions())
  const items = mappings.data ?? []
  const selected = items.find((mapping) => mapping.id === search.edit)
  const visible = items.filter(
    (mapping) =>
      (!search.spaces?.length || search.spaces.includes(mapping.space.id)) &&
      `${mapping.placeName} ${mapping.space.name}`.toLowerCase().includes((search.q ?? "").trim().toLowerCase()),
  )
  const page = Math.min(currentPage(search), pageCount(visible.length, pageSize))
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
        {mappings.isPending ? <SkeletonRows /> : null}
        {mappings.isError ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertTitle>Couldn’t load mappings</AlertTitle>
            <AlertDescription>
              {errorMessage(mappings.error)}
              <Button variant="outline" size="sm" onClick={() => void mappings.refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {mappings.isSuccess ? (
          <MappingsTable
            mappings={visible.slice((page - 1) * pageSize, page * pageSize)}
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
                    toast.success(`${mapping.placeName} disconnected`, {
                      action: {
                        label: "Undo",
                        onClick: () =>
                          restore.mutate(Channels.settingsOf(mapping), {
                            onError: (error) =>
                              toast.error("Couldn’t restore the mapping", {
                                description: errorMessage(error),
                                duration: Infinity,
                              }),
                          }),
                      },
                    }),
                  onError: (error) =>
                    toast.error("Couldn’t disconnect the mapping", {
                      description: errorMessage(error),
                      duration: Infinity,
                    }),
                },
              )
            }
          />
        ) : null}
        <div className="flex items-center justify-between gap-4 empty:hidden">
          <ListPagination page={page} pageSize={pageSize} total={visible.length} noun="mapping" />
        </div>
      </div>
      {search.add && mappings.isSuccess ? (
        <AddMappingDialog
          install={props.install}
          provider={props.provider}
          spaces={editableSpaces}
          triggers={props.triggers}
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
      <ExpandableSearch
        label="Search mappings"
        value={search.q ?? ""}
        onChange={(q) =>
          void navigate({
            search: (previous) => ({ ...previous, q: q || undefined, page: undefined }),
            replace: true,
          })
        }
      />
      <FilterMenu
        label="Filter mappings"
        properties={[
          {
            key: "space",
            label: "Space",
            any: "All spaces",
            icon: IconCube,
            options: props.spaces.map((space) => ({ value: space.id, label: space.name })),
          },
        ]}
        value={{ space: [...(search.spaces ?? [])] }}
        onChange={(value) =>
          void navigate({
            search: (previous) => ({
              ...previous,
              spaces: value.space?.length ? value.space : undefined,
              page: undefined,
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

function AddMappingDialog(props: {
  install: ChannelInstallInfo
  provider: Channels.Info
  spaces: ReadonlyArray<SpaceInfo>
  triggers: ReadonlyArray<ChannelTrigger>
  mappings: ReadonlyArray<ChannelMappingInfo>
  onClose: () => void
}) {
  const { client } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const places = useQuery(Channels.availablePlacesOptions(client, props.install.id))
  const selected = places.data?.find((place) => place.id === search.place)
  if (selected)
    return (
      <MappingDialog
        key={selected.id}
        install={props.install}
        place={selected}
        mapping={undefined}
        spaces={props.spaces}
        triggers={props.triggers}
        onClose={props.onClose}
      />
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {props.provider.noun}</DialogTitle>
          <DialogDescription>Choose a {props.provider.noun}, then its Ren space.</DialogDescription>
        </DialogHeader>
        {props.provider.id === "slack" ? (
          <p className="text-xs text-muted-foreground">
            To add a missing channel, run <code>/invite @Ren</code> in that Slack channel first.
          </p>
        ) : null}
        {places.isError ? (
          <p className="text-sm text-destructive">
            {errorMessage(places.error)}
            <Button variant="outline" size="sm" onClick={() => void places.refetch()}>
              Retry
            </Button>
          </p>
        ) : null}
        {places.isPending ? <SkeletonRows count={4} /> : null}
        {places.isSuccess ? (
          <Command>
            <CommandInput
              aria-label={`Search ${props.provider.plural}`}
              placeholder={`Search ${props.provider.plural}…`}
            />
            <CommandList>
              <CommandEmpty>No available {props.provider.plural}.</CommandEmpty>
              <CommandGroup>
                {places.data
                  .filter((place) => !props.mappings.some((mapping) => mapping.place === place.id))
                  .map((place) => (
                    <CommandItem
                      key={place.id}
                      value={place.id}
                      keywords={[place.name]}
                      onSelect={() =>
                        void navigate({ search: (previous) => ({ ...previous, place: place.id }), replace: true })
                      }
                    >
                      {place.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
