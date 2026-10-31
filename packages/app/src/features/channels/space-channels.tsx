import type { ChannelInstallInfo, ChannelMappingInfo, ChannelPlaceInfo, ChannelTriggerSetting } from "@ren/client"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ren/ui/dialog"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@ren/ui/field"
import { Icon } from "@ren/ui/icon"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@ren/ui/item"
import { RadioGroup, RadioGroupItem } from "@ren/ui/radio-group"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import { useQuery } from "@tanstack/react-query"
import { useId, useState } from "react"
import type { ReactNode } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { ChannelMappingData } from "./channel-mapping-data.js"
import { Channels } from "./channels.js"
import { MemberSelect, TriggerSettings } from "./route-dialog.js"
import { useInstall } from "./use-install.js"

type ChannelState = "routed" | "idle" | "unavailable" | "checking"

const stateCopy: Readonly<Record<ChannelState, { readonly summary: string; readonly label: string }>> = {
  routed: { summary: "Routed", label: "Routed to this space" },
  idle: { summary: "Not routed", label: "Not routed to this space" },
  unavailable: { summary: "Not connected", label: "Not connected" },
  checking: { summary: "Checking…", label: "Checking connection" },
}

const descriptions: Readonly<Record<Channels.Provider, string>> = {
  github: "Route a repository here.",
  slack: "Route a Slack channel here.",
  linear: "Route a Linear project here.",
}

const plurals: Readonly<Record<Channels.Provider, string>> = {
  github: "repositories",
  slack: "channels",
  linear: "projects",
}

export function SpaceChannels(props: { spaceId: string; userId: string }) {
  const context = RouterContext.useRouterContext()
  const installs = useQuery(context.api["channel-install"].list.queryOptions(ChannelMappingData.page))
  const offered = useQuery(context.api["channel-connect"]["channel-provider"].list.queryOptions())
  const changes = ChannelMappingData.useChanges()
  const available = new Set((offered.data?.items ?? []).map((provider) => provider.id))
  const byProvider = new Map((installs.data?.items ?? []).map((install) => [install.provider, install]))
  return (
    <div className="flex flex-col gap-3">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {Channels.providers
          .filter((provider) => available.has(provider.id))
          .map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              install={byProvider.get(provider.id)}
              loading={installs.isPending}
              spaceId={props.spaceId}
              changes={changes}
            />
          ))}
      </div>
      <output className="flex items-center justify-end" aria-live="polite">
        <Text purpose="caption" element="span">
          {changes.pending ? "Saving…" : "\u00a0"}
        </Text>
      </output>
    </div>
  )
}

function useCanConfigure(spaceId: string) {
  const context = RouterContext.useRouterContext()
  return (
    useQuery({
      ...context.api.space.get.queryOptions({ idOrSlug: spaceId }),
      select: (space) => space.canUpdate,
    }).data === true
  )
}

const channelState = (input: { loading: boolean; available: boolean; routed: boolean }): ChannelState => {
  if (input.loading) return "checking"
  if (!input.available) return "unavailable"
  return input.routed ? "routed" : "idle"
}

function ProviderCard(props: {
  provider: Channels.Info
  install: ChannelInstallInfo | undefined
  loading: boolean
  spaceId: string
  changes: ChannelMappingData.Changes
}) {
  const canConfigure = useCanConfigure(props.spaceId)
  const install = props.install
  const places = ChannelMappingData.usePlaces(install?.id ?? "", { enabled: install !== undefined })
  const connect = useInstall(props.provider.id, props.provider.title)
  const items = places.data?.items ?? []
  const selected = items.find((place) => place.mapping?.space.id === props.spaceId)
  const installed = install !== undefined
  const loading = props.loading || (installed && places.isPending)
  const routedTo = selected && `${props.provider.board.prefix}${selected.name}`
  return (
    <ChannelCard
      icon={<Icon glyph={props.provider.glyph} size="large" tone="primary" />}
      title={props.provider.title}
      description={descriptions[props.provider.id]}
      status={connect.isPending ? "Opening…" : routedTo}
      state={channelState({ loading, available: installed, routed: selected !== undefined })}
      action={
        <ConnectButton
          visible={[canConfigure, !loading, !installed].every(Boolean)}
          label={`Install Ren on ${props.provider.title}`}
          pending={connect.isPending}
          onClick={connect.install}
        />
      }
    >
      {[!canConfigure, loading, installed].some(Boolean) ? (
        <CardBody
          provider={props.provider}
          install={install}
          loading={loading}
          places={items}
          selected={selected}
          spaceId={props.spaceId}
          changes={props.changes}
        />
      ) : undefined}
    </ChannelCard>
  )
}

function CardBody(props: {
  provider: Channels.Info
  install: ChannelInstallInfo | undefined
  loading: boolean
  places: ReadonlyArray<ChannelPlaceInfo>
  selected: ChannelPlaceInfo | undefined
  spaceId: string
  changes: ChannelMappingData.Changes
}) {
  const install = props.install
  if (!useCanConfigure(props.spaceId))
    return (
      <Alert>
        <Icon glyph="Info" />
        <AlertDescription>Ask a member of this space to configure this channel.</AlertDescription>
      </Alert>
    )
  if (props.loading)
    return (
      <Empty className="p-0">
        <EmptyHeader>
          <EmptyMedia>
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>Loading {props.provider.board.label}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  if (!install) return null
  const previous = props.selected?.mapping ?? undefined
  const choose = (placeId: string | null) => {
    if (placeId === (props.selected?.id ?? null)) return
    const removePrevious = () => (previous ? props.changes.remove(previous.id) : undefined)
    if (placeId === null) return removePrevious()
    props.changes.save(
      { installId: install.id, place: placeId, spaceId: props.spaceId },
      previous ? ChannelMappingData.settingsOf(previous) : { triggers: [] },
      { onSuccess: removePrevious },
    )
  }
  return (
    <>
      <ResourcePicker
        options={props.places.map((place) => optionOf(place, props.spaceId, props.provider.board.prefix))}
        value={props.selected?.id ?? null}
        clearLabel={`No ${props.provider.title} ${props.provider.place.noun}`}
        emptyLabel={`No ${props.provider.title} ${plurals[props.provider.id]} available`}
        onChange={choose}
      />
      {previous ? <MappingSettings provider={props.provider.id} mapping={previous} changes={props.changes} /> : null}
      {props.provider.id === "slack" ? <SlackChannelNotice /> : null}
    </>
  )
}

function MappingSettings(props: {
  provider: Channels.Provider
  mapping: ChannelMappingInfo
  changes: ChannelMappingData.Changes
}) {
  if (props.provider === "github") return <TriggerCardSettings {...props} />
  return <SenderSettings {...props} />
}

const optionOf = (place: ChannelPlaceInfo, spaceId: string, prefix: string) => {
  const elsewhere = place.mapping && place.mapping.space.id !== spaceId ? place.mapping.space.name : undefined
  return {
    value: place.id,
    label: `${prefix}${place.name}`,
    detail: elsewhere && `Mapped to ${elsewhere}`,
    disabled: elsewhere !== undefined,
  }
}

const targetOf = (mapping: ChannelMappingInfo) => ({
  installId: mapping.installId,
  place: mapping.place,
  spaceId: mapping.space.id,
})

function TriggerCardSettings(props: {
  provider: Channels.Provider
  mapping: ChannelMappingInfo
  changes: ChannelMappingData.Changes
}) {
  const [triggers, setTriggers] = useState<ReadonlyArray<ChannelTriggerSetting>>(props.mapping.triggers)
  const save = (next: ReadonlyArray<ChannelTriggerSetting>) =>
    props.changes.save(targetOf(props.mapping), { ...ChannelMappingData.settingsOf(props.mapping), triggers: next })
  return (
    <TriggerSettings
      provider={props.provider}
      value={triggers}
      onChange={(next) => {
        setTriggers(next)
        if (next.length !== triggers.length) save(next)
      }}
      onPromptCommit={() => save(triggers)}
    />
  )
}

function SenderSettings(props: {
  provider: Channels.Provider
  mapping: ChannelMappingInfo
  changes: ChannelMappingData.Changes
}) {
  const slack = props.provider === "slack"
  const sender = props.mapping.fallback ? (props.mapping.fallbackUser?.id ?? "") : ""
  return (
    <div className="flex flex-col gap-1">
      <MemberSelect
        spaceId={props.mapping.space.id}
        label={slack ? "Fallback sender" : "Session sender"}
        placeholder={slack ? "Fallback sender (optional)" : "Select session sender"}
        clearLabel={slack ? "No fallback sender" : "No session sender"}
        size="sm"
        value={sender}
        onChange={(userId) =>
          props.changes.save(targetOf(props.mapping), {
            ...ChannelMappingData.settingsOf(props.mapping),
            fallback: userId !== "",
            ...(userId && { fallbackUserId: userId }),
          })
        }
      />
      {slack ? (
        <Text purpose="caption" element="span">
          Used when a Slack sender isn’t linked to Ren.
        </Text>
      ) : null}
      {!slack && !sender ? (
        <Text purpose="caption" tone="warning" element="span">
          Choose a sender to include these mappings.
        </Text>
      ) : null}
    </div>
  )
}

function SlackChannelNotice() {
  return (
    <Alert>
      <Icon glyph="Info" />
      <AlertDescription>
        Ren must be added to a channel before it appears here. Open the channel in Slack and run
        <code className="mx-1">
          <Text purpose="code" element="span">
            /invite @Ren
          </Text>
        </code>
        , then return here.
      </AlertDescription>
    </Alert>
  )
}

function ChannelCard(props: {
  icon: ReactNode
  title: string
  description: string
  status: string | undefined
  state: ChannelState
  action: ReactNode
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const hasBody = props.children !== undefined
  const copy = stateCopy[props.state]
  const checking = props.state === "checking"
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Item variant="outline" className="min-h-14 gap-x-4 rounded-xl bg-card px-4 py-3">
        <ItemMedia>{props.icon}</ItemMedia>
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className="max-w-full">
            <span className="truncate">{props.title}</span>
          </ItemTitle>
          <ItemDescription className="line-clamp-1 text-xs">
            {checking ? copy.summary : (props.status ?? copy.summary)}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <StateMark title={props.title} state={props.state}>
            {hasBody ? (
              <DialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label={`Configure ${props.title}`}
                  />
                }
              >
                <Icon glyph="ChevronRight" />
              </DialogTrigger>
            ) : null}
          </StateMark>
          {props.action}
        </ItemActions>
      </Item>
      {hasBody ? (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.title} integration</DialogTitle>
            <DialogDescription>{props.description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">{props.children}</div>
          <DialogFooter className="sm:justify-end">
            <DialogClose render={<Button type="button" />}>Done</DialogClose>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function StateMark(props: { title: string; state: ChannelState; children: ReactNode }) {
  const label = `${props.title}: ${stateCopy[props.state].label}`
  if (props.state === "checking") return <Spinner aria-label={`Loading ${props.title} channel`} />
  return (
    <span className="flex items-center gap-2" title={label}>
      {props.state === "routed" ? <Icon glyph="CheckCircle2" tone="success" /> : null}
      {props.children}
      <Text purpose="body" visibility="assistive" element="span">
        {label}
      </Text>
    </span>
  )
}

function ConnectButton(props: { visible: boolean; label: string; pending: boolean; onClick: () => void }) {
  if (!props.visible) return null
  const label = props.pending ? "Opening authorization…" : props.label
  return (
    <Button
      aria-label={label}
      title={label}
      disabled={props.pending}
      onClick={props.onClick}
      variant="outline"
      size="sm"
          >
      {props.pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
      {props.pending ? "Opening…" : "Connect"}
    </Button>
  )
}

function ResourcePicker(props: {
  options: ReadonlyArray<{ value: string; label: string; detail: string | undefined; disabled: boolean }>
  value: string | null
  clearLabel: string
  emptyLabel: string
  onChange: (value: string | null) => void
}) {
  const id = useId()
  return (
    <RadioGroup
      aria-label="Resource"
      value={props.value ?? ""}
      onValueChange={(next: string) => props.onChange(next || null)}
      className="max-h-72 gap-0 divide-y overflow-y-auto overscroll-contain rounded-lg border"
    >
      <Field orientation="horizontal" className="px-3 py-2.5">
        <RadioGroupItem value="" id={`${id}-none`} />
        <FieldLabel htmlFor={`${id}-none`} className="font-normal">
          {props.clearLabel}
        </FieldLabel>
      </Field>
      {props.options.length === 0 ? (
        <div className="p-3">
          <Text purpose="caption">{props.emptyLabel}</Text>
        </div>
      ) : (
        props.options.map((option) => (
          <Field
            key={option.value}
            orientation="horizontal"
            data-disabled={option.disabled || undefined}
            className="px-3 py-2.5"
          >
            <RadioGroupItem value={option.value} id={`${id}-${option.value}`} disabled={option.disabled} />
            <FieldContent>
              <FieldLabel htmlFor={`${id}-${option.value}`} className="font-normal">
                {option.label}
              </FieldLabel>
              {option.detail ? <FieldDescription className="text-xs">{option.detail}</FieldDescription> : null}
            </FieldContent>
          </Field>
        ))
      )}
    </RadioGroup>
  )
}
