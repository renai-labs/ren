import { useState, type ReactNode } from "react"
import type { ChannelInstallInfo, ChannelMappingInfo, ChannelPlaceInfo, ChannelTrigger, SpaceInfo } from "@ren/client"
import { useMutation, useQuery, useSuspenseQuery, type UseQueryResult } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconCube,
  IconPlugOff,
  IconSettings,
  IconX,
} from "@tabler/icons-react"
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
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Separator } from "@ren/ui/separator"
import { Skeleton } from "@ren/ui/skeleton"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { ChannelMark, placeIcons } from "../../components/channel-mark.js"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { EmptyState } from "../../components/empty-state.js"
import { ExpandableSearch } from "../../components/expandable-search.js"
import { Page } from "../../components/page.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { errorMessage } from "../../lib/errors.js"
import { Channels } from "../../lib/channels.js"
import { Choice } from "../../components/settings-shared.js"
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
  const [resetting, setResetting] = useState(false)
  const provider = Channels.byId[params.provider]
  const error = search.error
  const connecting = start.isPending
  const connect = () =>
    start.mutate(
      { provider: provider.id },
      {
        onSuccess: (result) => platform.redirect?.(result.redirectUrl),
        onError: (error) => toast.error(`Couldn’t connect ${provider.title}`, { description: errorMessage(error) }),
      },
    )
  const reset = (id: string) =>
    remove.mutateAsync(
      { id },
      {
        onSuccess: () => toast.success(`${provider.title} mappings reset`),
        onError: (error) => toast.error("Couldn’t reset the mappings", { description: errorMessage(error) }),
      },
    )
  return (
    <Page
      title={provider.title}
      back={
        <Link
          to="/settings/channels"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground" })}
        >
          <IconArrowLeft />
          Back to channels
        </Link>
      }
      media={
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <ChannelMark provider={provider.id} className="size-8" />
        </span>
      }
      menu={
        install?.canUpdate ? (
          <Button variant="outline" size="sm" onClick={() => setResetting(true)}>
            <IconPlugOff data-icon="inline-start" />
            Reset mappings
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
      {install ? <MappingBoard install={install} provider={provider} triggers={offered?.triggers ?? []} /> : null}
      {install ? null : (
        <NotInstalled provider={provider} offered={offered !== undefined} connecting={connecting} onConnect={connect} />
      )}
      {install ? (
        <ConfirmDialog
          open={resetting}
          onOpenChange={setResetting}
          confirmation={{
            title: `Reset ${provider.title} mappings?`,
            description: `This clears every mapping and uninstalls Ren from ${provider.title}. You can connect it again later.`,
            action: "Reset mappings",
          }}
          onConfirm={() => reset(install.id)}
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
          {props.connecting ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ChannelMark provider={props.provider.id} className="size-4" />
          )}
          Connect {props.provider.title}
        </Button>
      }
    >
      Connect {props.provider.title} so people can mention @Ren in its {props.provider.plural}.
    </EmptyState>
  )
}

function SpaceColumn(props: {
  spaces: ReadonlyArray<SpaceInfo>
  places: ReadonlyArray<ChannelPlaceInfo>
  selected: string | undefined
  onSelect: (spaceId: string) => void
}) {
  const [spaceQuery, setSpaceQuery] = useState("")
  return (
    <BoardColumn
      title="1. Select a Ren space"
      count={props.spaces.length}
      search={<ExpandableSearch label="Search spaces" value={spaceQuery} onChange={setSpaceQuery} />}
    >
      {props.spaces
        .filter((space) => space.name.toLowerCase().includes(spaceQuery.trim().toLowerCase()))
        .map((space) => {
          const linked = props.places.filter((place) => place.mapping?.space.id === space.id).length
          return (
            <Item
              key={space.id}
              size="sm"
              // oxlint-disable-next-line react/forbid-elements -- Item renders as the row's button, as shadcn's Item does
              render={<button type="button" aria-label={space.name} aria-pressed={space.id === props.selected} />}
              className="h-11 hover:bg-muted aria-pressed:bg-muted"
              onClick={() => props.onSelect(space.id)}
            >
              <ItemMedia className="*:[svg]:size-4">
                <IconCube className="text-muted-foreground" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="truncate">{space.name}</ItemTitle>
              </ItemContent>
              {linked > 0 ? (
                <ItemActions className="text-xs text-muted-foreground tabular-nums">{linked}</ItemActions>
              ) : null}
            </Item>
          )
        })}
    </BoardColumn>
  )
}

function PlaceStatus(props: {
  places: Pick<UseQueryResult, "isPending" | "isSuccess" | "error">
  empty: boolean
  query: string
  plural: string
}) {
  if (props.places.isPending) return Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-11" />)
  if (props.places.error)
    return (
      <p className="p-2 text-sm text-muted-foreground">
        {errorMessage(props.places.error, `Couldn’t list the ${props.plural}.`)}
      </p>
    )
  if (!props.places.isSuccess || !props.empty) return null
  return (
    <p className="p-2 text-sm text-muted-foreground">
      {props.query.trim() ? "Nothing matches" : `No ${props.plural} yet`}
    </p>
  )
}

function MappingBoard(props: {
  install: ChannelInstallInfo
  provider: Channels.Info
  triggers: ReadonlyArray<ChannelTrigger>
}) {
  const { api } = RouterContext.useRouterContext()
  const spaces = useSpaces().spaces.toSorted((left, right) => left.name.localeCompare(right.name))
  const places = useQuery(Channels.placesOptions(api, props.install.id))
  const create = useMutation({ ...api["channel-mapping"].create.mutationOptions() })
  const remove = useMutation({ ...api["channel-mapping"].remove.mutationOptions() })
  const [chosen, setChosen] = useState<string>()
  const [placeQuery, setPlaceQuery] = useState("")
  const [configuring, setConfiguring] = useState<ChannelMappingInfo>()
  const selected = chosen ?? spaces.at(0)?.id
  const items = places.data?.items ?? []
  const busy = create.isPending || remove.isPending
  const PlaceIcon = placeIcons[props.provider.id]
  const failed = (action: string) => (error: Error) =>
    toast.error(`Couldn’t ${action} the ${props.provider.noun}`, { description: errorMessage(error) })
  const visiblePlaces = items
    .filter((place) => place.name.toLowerCase().includes(placeQuery.trim().toLowerCase()))
    .toSorted(
      (left, right) => Number(right.mapping?.space.id === selected) - Number(left.mapping?.space.id === selected),
    )
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SpaceColumn spaces={spaces} places={items} selected={selected} onSelect={setChosen} />
        <BoardColumn
          title={`2. Select ${props.provider.plural}`}
          count={items.length}
          search={
            <ExpandableSearch label={`Search ${props.provider.plural}`} value={placeQuery} onChange={setPlaceQuery} />
          }
        >
          <PlaceStatus
            places={places}
            empty={visiblePlaces.length === 0}
            query={placeQuery}
            plural={props.provider.plural}
          />
          {visiblePlaces.map((place) => {
            const mapping = place.mapping
            const name = Channels.label(props.provider.id, place.name)
            if (mapping && mapping.space.id === selected)
              return (
                <Item key={place.id} size="sm" className="h-11 bg-muted pr-1.5">
                  <ItemMedia className="*:[svg]:size-4">
                    <IconCheck className="text-chart-2" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="truncate">{name}</ItemTitle>
                  </ItemContent>
                  <ItemActions className="gap-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      aria-label={`${name} settings`}
                      disabled={busy}
                      onClick={() => setConfiguring(mapping)}
                    >
                      <IconSettings />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      aria-label={`Unlink ${name}`}
                      disabled={busy}
                      onClick={() => remove.mutate({ id: mapping.id }, { onError: failed("unlink") })}
                    >
                      <IconX />
                    </Button>
                  </ItemActions>
                </Item>
              )
            return (
              <Item
                key={place.id}
                size="sm"
                // oxlint-disable-next-line react/forbid-elements -- Item renders as the row's button, as shadcn's Item does
                render={<button type="button" aria-label={`Link ${name}`} disabled={busy || !selected} />}
                className="h-11 hover:bg-muted disabled:opacity-50"
                onClick={() =>
                  selected &&
                  create.mutate(
                    mapping
                      ? { ...Channels.settingsOf(mapping), spaceId: selected }
                      : { installId: props.install.id, place: place.id, spaceId: selected },
                    { onError: failed("link") },
                  )
                }
              >
                <ItemMedia>
                  <PlaceIcon className="size-4 text-muted-foreground" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="truncate">{name}</ItemTitle>
                </ItemContent>
                {mapping ? (
                  <ItemActions className="max-w-1/2 truncate text-xs text-muted-foreground">
                    {mapping.space.name}
                  </ItemActions>
                ) : null}
              </Item>
            )
          })}
        </BoardColumn>
      </div>
      {props.provider.id === "slack" ? (
        <p className="text-xs text-muted-foreground">
          A channel shows up here once Ren is in it. In Slack, run <code>/invite @Ren</code> in the channel.
        </p>
      ) : null}
      {configuring ? (
        <MappingDialog
          mapping={configuring}
          name={Channels.label(props.provider.id, configuring.placeName)}
          triggers={props.triggers}
          saving={create.isPending}
          onSave={(settings) =>
            create.mutate(
              { ...Channels.settingsOf(configuring), ...settings },
              { onSuccess: () => setConfiguring(undefined), onError: failed("save") },
            )
          }
          onClose={() => setConfiguring(undefined)}
        />
      ) : null}
    </>
  )
}

function BoardColumn(props: { title: string; count: number; search: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={props.title} className="flex min-w-0 flex-col rounded-xl border bg-card">
      <div className="flex h-12 items-center justify-between gap-2 pr-2 pl-4">
        <span className="truncate text-sm font-medium">
          {props.title} <span className="font-normal text-muted-foreground tabular-nums">({props.count})</span>
        </span>
        {props.search}
      </div>
      <Separator />
      <ItemGroup className="h-96 gap-1 overflow-y-auto overscroll-contain p-2 has-data-[size=sm]:gap-1">
        {props.children}
      </ItemGroup>
    </section>
  )
}

function MappingDialog(props: {
  mapping: ChannelMappingInfo
  name: string
  triggers: ReadonlyArray<ChannelTrigger>
  saving: boolean
  onSave: (settings: {
    fallback: boolean
    fallbackUserId?: string
    triggers: Array<{ id: string; prompt?: string }>
  }) => void
  onClose: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const members = useQuery(
    api["space-member"].list.queryOptions({ spaceId: props.mapping.space.id, page: 1, pageSize: 100 }),
  )
  const [sender, setSender] = useState(props.mapping.fallback ? (props.mapping.fallbackUser?.id ?? "") : "")
  const [triggers, setTriggers] = useState(props.mapping.triggers)
  const current = props.mapping.fallbackUser
  const options = [
    { value: "", label: "Nobody" },
    ...(current && !members.data?.items.some((member) => member.status === "active" && member.userId === current.id)
      ? [{ value: current.id, label: current.name }]
      : []),
    ...(members.data?.items ?? []).flatMap((member) =>
      member.status === "active" ? [{ value: member.userId, label: member.name || member.email }] : [],
    ),
  ]
  return (
    <Dialog open onOpenChange={(open) => (open || props.saving ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.name}</DialogTitle>
          <DialogDescription>Linked to {props.mapping.space.name}.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>Fallback sender</FieldLabel>
            <Choice label="Fallback sender" options={options} value={sender} className="w-full" onChange={setSender} />
            <FieldDescription>Ren runs as this person when it can’t match the sender to a member.</FieldDescription>
          </Field>
          {props.triggers.map((trigger) => (
            <Field key={trigger.id} orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={`trigger-${trigger.id}`}>{trigger.title}</FieldLabel>
                <FieldDescription>{trigger.description}</FieldDescription>
              </FieldContent>
              <Switch
                id={`trigger-${trigger.id}`}
                checked={triggers.some((each) => each.id === trigger.id)}
                onCheckedChange={(on) =>
                  setTriggers(
                    on ? [...triggers, { id: trigger.id }] : triggers.filter((each) => each.id !== trigger.id),
                  )
                }
              />
            </Field>
          ))}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={props.saving}>
            Cancel
          </DialogClose>
          <Button
            disabled={props.saving}
            onClick={() =>
              props.onSave({
                fallback: sender !== "",
                ...(sender && { fallbackUserId: sender }),
                triggers: [...triggers],
              })
            }
          >
            {props.saving ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
