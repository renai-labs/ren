import { useState } from "react"
import type { ProviderCardInfo, ProviderCardPage, RenInferenceConnection } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconChevronRight, IconKey, IconPlus, IconTrash } from "@tabler/icons-react"
import { Button, buttonVariants } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { Loading } from "@ren/ui/loading"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { toast } from "@ren/ui/sonner"
import { Switch } from "@ren/ui/switch"
import { formatDateTime } from "@ren/ui/time"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { EditableText } from "../../components/editable-text.js"
import { EmptyState } from "../../components/empty-state.js"
import { Page, useShapeId } from "../../components/page.js"
import { ProviderMark } from "../../components/provider-mark.js"
import { StatusBadge } from "../../components/status-badge.js"
import { SubscriptionMeters } from "../../components/subscription-meters.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { AddProviderDialog } from "./add-provider-dialog.js"
import { ChatGptGuide } from "./chatgpt-guide.js"
import { ConnectDialog, type Connecting } from "./connect-dialog.js"

const methods = [
  { value: "key", label: "API key" },
  { value: "subscription", label: "Subscription" },
] as const

const signIn: Readonly<Record<string, string>> = { anthropic: "Connect your Claude", openai: "Sign in with ChatGPT" }

const sample: ProviderCardPage = {
  ren: { enabled: true, newModelsOn: true, modelCount: 0, free: null, canManage: false },
  cards: [],
  available: [],
}

function Heading(props: { name: string; toggle: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <ProviderMark provider={props.name} />
        <h2 className="truncate text-sm font-medium">{props.name}</h2>
        {props.toggle}
      </div>
      <div className="flex flex-wrap items-center gap-2">{props.children}</div>
    </div>
  )
}

function OnSwitch(props: { name: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <Switch
      aria-label={`${props.name} on`}
      checked={props.checked}
      disabled={props.disabled}
      onCheckedChange={props.onChange}
    />
  )
}

function RenCard(props: { ren: ProviderCardPage["ren"]; onToggle: (enabled: boolean) => void }) {
  const free = props.ren.free
  return (
    <Card className="gap-2 px-4" aria-label="Ren">
      <Heading
        name="Ren"
        toggle={
          <OnSwitch name="Ren" checked={props.ren.enabled} disabled={!props.ren.canManage} onChange={props.onToggle} />
        }
      >
        {free ? (
          <span className="text-xs text-muted-foreground">
            Free today {free.used} / {free.limit}
          </span>
        ) : null}
        <Link to="/settings/providers/ren-models" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Models
          <IconChevronRight />
        </Link>
      </Heading>
      <p className="text-xs text-muted-foreground">
        {props.ren.enabled
          ? `${props.ren.modelCount} models on Ren credit, free models every day.`
          : "Off. Ren’s models, free ones included, leave the pickers."}
      </p>
    </Card>
  )
}

function KeyLine(props: { card: ProviderCardInfo; onReplace: () => void; onRemove: () => void }) {
  const key = props.card.key
  if (!key)
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>No key</span>
        {props.card.canManage ? (
          <Button size="sm" variant="outline" onClick={props.onReplace}>
            <IconKey />
            Add key
          </Button>
        ) : null}
      </div>
    )
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        <span className="font-mono">…{key.last4}</span> · Tested {formatDateTime(key.testedAt)}
        {key.savedBy?.name ? ` · ${key.savedBy.name}` : ""}
      </span>
      {props.card.canManage ? (
        <span className="flex gap-1">
          <Button size="sm" variant="outline" onClick={props.onReplace}>
            Replace key
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onRemove}>
            Remove key
          </Button>
        </span>
      ) : null}
    </div>
  )
}

function Seats(props: {
  card: ProviderCardInfo
  onConnect: (connectionId?: string) => void
  onRename: (id: string, label: string) => Promise<unknown>
  onRemove: (connection: RenInferenceConnection) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {props.card.id === "openai" && props.card.canManage ? <ChatGptGuide /> : null}
      {props.card.seats.length === 0 ? (
        <p className="text-xs text-muted-foreground">No subscription yet. Any member can connect theirs.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {props.card.seats.map((connection) => (
            <SeatCard
              key={connection.id}
              connection={connection}
              onReconnect={() => props.onConnect(connection.id)}
              onRename={(label) => props.onRename(connection.id, label)}
              onRemove={() => props.onRemove(connection)}
            />
          ))}
        </div>
      )}
      <div>
        <Button size="sm" variant="outline" onClick={() => props.onConnect()}>
          <IconPlus />
          {signIn[props.card.id] ?? `Connect ${props.card.name}`}
        </Button>
      </div>
    </div>
  )
}

function ProviderCardView(props: {
  card: ProviderCardInfo
  onUpdate: (input: { enabled?: boolean; method?: "key" | "subscription" }) => void
  onKey: () => void
  onRemoveKey: () => void
  onConnect: (connectionId?: string) => void
  onRename: (id: string, label: string) => Promise<unknown>
  onRemoveSeat: (connection: RenInferenceConnection) => void
}) {
  const card = props.card
  return (
    <Card className="gap-3 px-4" aria-label={card.name}>
      <Heading
        name={card.name}
        toggle={
          <OnSwitch
            name={card.name}
            checked={card.enabled}
            disabled={!card.canManage}
            onChange={(enabled) => props.onUpdate({ enabled })}
          />
        }
      >
        {card.methods.length > 1 ? (
          <Select
            items={methods}
            value={card.method}
            disabled={!card.canManage}
            onValueChange={(value) => {
              if (value === "key" || value === "subscription") props.onUpdate({ method: value })
            }}
          >
            <SelectTrigger size="sm" aria-label={`${card.name} method`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {methods.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {card.modelCount === 1 ? "1 model" : `${card.modelCount} models`}
        </span>
      </Heading>
      {card.method === "subscription" ? (
        <Seats card={card} onConnect={props.onConnect} onRename={props.onRename} onRemove={props.onRemoveSeat} />
      ) : (
        <KeyLine card={card} onReplace={props.onKey} onRemove={props.onRemoveKey} />
      )}
    </Card>
  )
}

export function ProvidersPage() {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const list = useQuery({ ...api.provider.list.queryOptions(), retry: false })
  const update = useMutation(api.provider.update.mutationOptions())
  const removeKey = useMutation(api.provider.key.remove.mutationOptions())
  const connectSeat = useMutation(api["ren-inference"].connect.mutationOptions())
  const rename = useMutation(api["ren-inference"].connection.rename.mutationOptions())
  const removeSeat = useMutation(api["ren-inference"].connection.remove.mutationOptions())
  const [adding, setAdding] = useState(false)
  const [connecting, setConnecting] = useState<Connecting>()
  const [removing, setRemoving] = useState<{ title: string; run: () => Promise<unknown> }>()
  const shapeId = useShapeId("providers")
  const page = list.data ?? sample
  const failed = (action: string) => (error: unknown) => toast.error(action, { description: errorMessage(error) })
  const change = (id: string, input: { enabled?: boolean; method?: "key" | "subscription" }) =>
    update.mutate({ id, ...input }, { onError: failed("Couldn’t change the provider") })
  const startSignIn = (connectionId?: string) =>
    connectSeat.mutate(
      { returnUrl: `${platform.appUrl}/settings/providers`, ...(connectionId && { connectionId }) },
      {
        onSuccess: (result) => {
          platform.openExternal(result.url)
          toast("Opened the sign-in in a new tab", { description: "Ren lists the subscription once you finish there." })
        },
        onError: failed("Couldn’t start the sign-in"),
      },
    )
  return (
    <Page
      title="Providers"
      description="Ren’s models, your own keys and your team’s subscriptions."
      aside={
        <>
          <Link to="/settings/providers/keys" className={buttonVariants({ variant: "outline" })}>
            <IconKey />
            Inference keys
          </Link>
          {page.ren.canManage ? (
            <Button onClick={() => setAdding(true)}>
              <IconPlus />
              Add provider
            </Button>
          ) : null}
        </>
      }
    >
      <Loading id={shapeId} loading={list.isPending} label="Loading providers">
        {list.isError ? (
          <EmptyState>Providers aren’t available on this server yet.</EmptyState>
        ) : (
          <section aria-label="Your providers" className="flex flex-col gap-3">
            <RenCard ren={page.ren} onToggle={(enabled) => change("ren", { enabled })} />
            {page.cards.map((card) => (
              <ProviderCardView
                key={card.id}
                card={card}
                onUpdate={(input) => change(card.id, input)}
                onKey={() => setConnecting(card)}
                onRemoveKey={() =>
                  setRemoving({
                    title: `Remove the ${card.name} key?`,
                    run: () => removeKey.mutateAsync({ id: card.id }, { onError: failed("Couldn’t remove the key") }),
                  })
                }
                onConnect={startSignIn}
                onRename={(id, label) => rename.mutateAsync({ id, label }, { onError: failed("Couldn’t rename") })}
                onRemoveSeat={(connection) =>
                  setRemoving({
                    title: `Remove ${connection.label}?`,
                    run: () => removeSeat.mutateAsync({ id: connection.id }, { onError: failed("Couldn’t remove") }),
                  })
                }
              />
            ))}
          </section>
        )}
      </Loading>
      {adding ? (
        <AddProviderDialog
          available={page.available}
          onOpenChange={setAdding}
          onConnect={(provider) => {
            setAdding(false)
            setConnecting(provider)
          }}
        />
      ) : null}
      {connecting ? (
        <ConnectDialog
          provider={connecting}
          onOpenChange={(open) => {
            if (!open) setConnecting(undefined)
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(undefined)
          }}
          confirmation={{
            title: removing.title,
            description: "New requests stop using it right away.",
            action: "Remove",
          }}
          onConfirm={removing.run}
        />
      ) : null}
    </Page>
  )
}

function SeatCard(props: {
  connection: RenInferenceConnection
  onReconnect: () => void
  onRename: (label: string) => Promise<unknown>
  onRemove: () => void
}) {
  const connection = props.connection
  return (
    <Card className="relative gap-3 border px-4 ring-0">
      <div
        className={connection.canReconnect ? "flex min-w-0 flex-col gap-1 pr-36" : "flex min-w-0 flex-col gap-1 pr-8"}
      >
        <span className="truncate text-sm font-medium">
          {connection.canManage ? (
            <EditableText value={connection.label} label="subscription name" required onCommit={props.onRename} />
          ) : (
            connection.label
          )}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge tone={connection.status.tone}>{connection.status.label}</StatusBadge>
          {connection.plan ? <span>· {connection.plan}</span> : null}
        </span>
      </div>
      {connection.canManage ? (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
          {connection.canReconnect ? (
            <Button variant="secondary" size="sm" onClick={props.onReconnect}>
              Sign in again
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Remove ${connection.label}`}
            onClick={props.onRemove}
          >
            <IconTrash />
          </Button>
        </div>
      ) : null}
      {connection.meters.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {connection.canReconnect ? "Sign in again to keep using it." : "Usage appears after the first request."}
        </p>
      ) : (
        <SubscriptionMeters meters={connection.meters} />
      )}
    </Card>
  )
}
