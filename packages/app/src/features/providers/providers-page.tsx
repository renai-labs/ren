import { useState } from "react"
import type { ProviderInfo, ProviderPage, RenInferenceConnection } from "@ren/client"
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
import { useCanAdminister } from "../../lib/use-organization.js"
import { Platform } from "../../platform/platform.js"
import { ChatGptGuide } from "./chatgpt-guide.js"
import { ConnectDialog } from "./connect-dialog.js"

const methods = [
  { value: "key", label: "API key" },
  { value: "subscription", label: "Subscription" },
] as const

const signIn: Readonly<Record<string, string>> = { anthropic: "Connect your Claude", openai: "Sign in with ChatGPT" }

const sample: ProviderPage = {
  providers: [
    {
      id: "sample",
      name: "Provider",
      mark: "sample",
      payer: "ren",
      builtIn: true,
      enabled: true,
      methods: [],
      fields: [],
      key: null,
      seats: [],
      modelCount: 0,
      canManage: false,
    },
  ],
  available: [],
}

const modelCount = (count: number) => (count === 1 ? "1 model" : `${count} models`)

function KeyLine(props: { provider: ProviderInfo; onReplace: () => void; onRemove: () => void }) {
  const key = props.provider.key
  if (!key)
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>No key</span>
        {props.provider.canManage ? (
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
      {props.provider.canManage ? (
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
  provider: ProviderInfo
  seats: ReadonlyArray<RenInferenceConnection>
  onConnect: (connectionId?: string) => void
  onRename: (id: string, label: string) => Promise<unknown>
  onRemove: (connection: RenInferenceConnection) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {props.provider.id === "openai" && props.provider.canManage ? <ChatGptGuide /> : null}
      {props.seats.length === 0 ? (
        <p className="text-xs text-muted-foreground">No subscription yet. Any member can connect theirs.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {props.seats.map((connection) => (
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
          {signIn[props.provider.id] ?? `Connect ${props.provider.name}`}
        </Button>
      </div>
    </div>
  )
}

function ProviderView(props: {
  provider: ProviderInfo
  onUpdate: (input: { enabled?: boolean; method?: "key" | "subscription" }) => void
  onKey: () => void
  onRemoveKey: () => void
  onConnect: (connectionId?: string) => void
  onRename: (id: string, label: string) => Promise<unknown>
  onRemoveSeat: (connection: RenInferenceConnection) => void
}) {
  const provider = props.provider
  return (
    <Card className="gap-3 px-4" aria-label={provider.name}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderMark provider={provider.name} />
          <h2 className="truncate text-sm font-medium">{provider.name}</h2>
          <Switch
            aria-label={`${provider.name} on`}
            checked={provider.enabled}
            disabled={!provider.canManage}
            onCheckedChange={(enabled) => props.onUpdate({ enabled })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {provider.methods.length > 1 ? (
            <Select
              items={methods}
              value={provider.method}
              disabled={!provider.canManage}
              onValueChange={(value) => {
                if (value === "key" || value === "subscription") props.onUpdate({ method: value })
              }}
            >
              <SelectTrigger size="sm" aria-label={`${provider.name} method`}>
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
          <Link
            to="/settings/providers/$id/models"
            params={{ id: provider.id }}
            aria-label={`${provider.name} models`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {modelCount(provider.modelCount)}
            <IconChevronRight />
          </Link>
        </div>
      </div>
      {provider.enabled ? null : <p className="text-xs text-muted-foreground">Off. Its models leave the pickers.</p>}
      {provider.method === "key" ? (
        <KeyLine provider={provider} onReplace={props.onKey} onRemove={props.onRemoveKey} />
      ) : null}
      {provider.method === "subscription" ? (
        <Seats
          provider={provider}
          seats={provider.seats}
          onConnect={props.onConnect}
          onRename={props.onRename}
          onRemove={props.onRemoveSeat}
        />
      ) : null}
    </Card>
  )
}

export function ProvidersPage() {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const isAdmin = useCanAdminister()
  const list = useQuery({ ...api.provider.list.queryOptions(), retry: false })
  const update = useMutation(api.provider.update.mutationOptions())
  const removeKey = useMutation(api.provider.key.remove.mutationOptions())
  const connectSeat = useMutation(api["ren-inference"].connect.mutationOptions())
  const rename = useMutation(api["ren-inference"].connection.rename.mutationOptions())
  const removeSeat = useMutation(api["ren-inference"].connection.remove.mutationOptions())
  const [connecting, setConnecting] = useState<ProviderInfo>()
  const [removing, setRemoving] = useState<{ title: string; run: () => Promise<unknown> }>()
  const shapeId = useShapeId("providers")
  const page = list.data ?? sample
  const failed = (action: string) => (error: unknown) => toast.error(action, { description: errorMessage(error) })
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
      description="The models your team’s agents run on: Ren’s, your own keys and your team’s subscriptions."
      aside={
        <>
          <Link to="/settings/providers/keys" className={buttonVariants({ variant: "outline" })}>
            <IconKey />
            Inference keys
          </Link>
          {isAdmin && !list.isError ? (
            <Link to="/settings/providers/connect" className={buttonVariants()}>
              <IconPlus />
              Add provider
            </Link>
          ) : null}
        </>
      }
    >
      <Loading id={shapeId} loading={list.isPending} label="Loading providers">
        {list.isError ? (
          <EmptyState>Providers aren’t available on this server yet.</EmptyState>
        ) : (
          <section aria-label="Your providers" className="flex flex-col gap-3">
            {page.providers.map((provider) => (
              <ProviderView
                key={provider.id}
                provider={provider}
                onUpdate={(input) =>
                  update.mutate({ id: provider.id, ...input }, { onError: failed("Couldn’t change the provider") })
                }
                onKey={() => setConnecting(provider)}
                onRemoveKey={() =>
                  setRemoving({
                    title: `Remove the ${provider.name} key?`,
                    run: () =>
                      removeKey.mutateAsync({ id: provider.id }, { onError: failed("Couldn’t remove the key") }),
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
      {connecting ? (
        <ConnectDialog
          provider={connecting}
          onOpenChange={(open) => {
            if (!open) setConnecting(undefined)
          }}
          onConnected={() => setConnecting(undefined)}
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
