import { useState } from "react"
import type { ProviderInfo, ProviderModel, ProviderModelList, RenInferenceConnection } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconArrowLeft, IconBrain, IconFileText, IconKey, IconPhoto, IconPlus, IconTrash } from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { Button, buttonVariants } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { Loading } from "@ren/ui/loading"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { toast } from "@ren/ui/sonner"
import { Switch } from "@ren/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { formatDateTime, formatUtcDate } from "@ren/ui/time"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { EditableText } from "../../components/editable-text.js"
import { EmptyState } from "../../components/empty-state.js"
import { Page, useShapeId } from "../../components/page.js"
import { ProviderMark } from "../../components/provider-mark.js"
import { StatusBadge } from "../../components/status-badge.js"
import { SubscriptionLimits } from "../../components/subscription-limits.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { ChatGptGuide } from "./chatgpt-guide.js"
import { ConnectDialog } from "./connect-dialog.js"
import { ModelTypes } from "./model-types.js"

const route = getRouteApi("/_authed/_shell/settings/providers/$id/")

const methods = [
  { value: "key", label: "API key" },
  { value: "subscription", label: "Subscription" },
] as const

const signIn: Readonly<Record<string, string>> = { anthropic: "Connect your Claude", openai: "Sign in with ChatGPT" }

const filters = ["All", "On", "Free"] as const
type Filter = (typeof filters)[number]

const shownBy: Readonly<Record<Filter, (model: ProviderModel) => boolean>> = {
  All: () => true,
  On: (model) => model.enabled,
  Free: (model) => model.free,
}

const usd = (value: number | undefined) => (value === undefined ? "–" : `$${value.toFixed(2)}`)

const tokens = (value: number | undefined) => {
  if (value === undefined) return "–"
  if (value >= 1_000_000) return `${value / 1_000_000}M`
  return `${Math.round(value / 1000)}K`
}

// oxlint-disable-next-line ren/no-comments -- models.dev dates are `YYYY-MM-DD` or `YYYY-MM`.
const released = (value: string | undefined) =>
  value ? formatUtcDate(value.length === 7 ? `${value}-01` : value) : "–"

const sample: ProviderModelList = {
  canManage: false,
  models: Array.from({ length: 8 }, (_, index) => ({
    id: `vendor/model-${index}`,
    name: "Model name",
    type: "chat",
    input: ["text"],
    reasoning: false,
    free: false,
    enabled: true,
  })),
}

// oxlint-disable-next-line ren/no-comments -- What a model can do besides text, each with a tooltip that names it.
const features = [
  { label: "Reasoning", icon: IconBrain, has: (model: ProviderModel) => model.reasoning },
  { label: "Reads images", icon: IconPhoto, has: (model: ProviderModel) => model.input.includes("image") },
  { label: "Reads PDFs", icon: IconFileText, has: (model: ProviderModel) => model.input.includes("pdf") },
]

function Features(props: { model: ProviderModel }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      {features
        .filter((feature) => feature.has(props.model))
        .map((feature) => (
          <Tooltip key={feature.label}>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon-sm" className="size-6" aria-label={feature.label} />}
            >
              <feature.icon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{feature.label}</TooltipContent>
          </Tooltip>
        ))}
    </span>
  )
}

function ModelName(props: { model: ProviderModel }) {
  return (
    <div className="flex flex-col">
      <span className="flex flex-wrap items-center gap-2 break-words">
        {props.model.name}
        {props.model.free ? <Badge variant="secondary">Free</Badge> : null}
      </span>
      <span className="font-mono text-xs break-all text-muted-foreground">{props.model.id}</span>
    </div>
  )
}

const emptyText = (name: string, type: string, filter: Filter) => {
  const kind = ModelTypes.labelOf(type).toLowerCase()
  return filter === "All" ? `${name} has no ${kind} models.` : `No ${kind} models match “${filter}”.`
}

function Models(props: { providerId: string; name: string }) {
  const { api } = RouterContext.useRouterContext()
  const list = useQuery(api.provider.models.list.queryOptions({ id: props.providerId }))
  const update = useMutation(api.provider.models.update.mutationOptions())
  const [filter, setFilter] = useState<Filter>("All")
  const [typeChoice, setTypeChoice] = useState<string>()
  const shapeId = useShapeId("provider-models")
  const data = list.data ?? sample
  const types = ModelTypes.labels.filter((each) => data.models.some((model) => model.type === each[0]))
  const type = typeChoice && types.some((each) => each[0] === typeChoice) ? typeChoice : (types.at(0)?.[0] ?? "chat")
  const shown = data.models.filter((model) => model.type === type && shownBy[filter](model))
  const failed = (error: unknown) => toast.error("Couldn’t change the models", { description: errorMessage(error) })
  return (
    <section aria-label={`${props.name} models`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={filter} onValueChange={(value) => setFilter(filters.find((each) => each === value) ?? "All")}>
          <TabsList aria-label="Filter models">
            {filters.map((each) => (
              <TabsTrigger key={each} value={each}>
                {each}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {types.length > 1 ? (
          <Tabs value={type} onValueChange={(value) => setTypeChoice(String(value))}>
            <TabsList aria-label="Model type">
              {types.map((each) => (
                <TabsTrigger key={each[0]} value={each[0]}>
                  {each[1]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <Badge variant="outline">{ModelTypes.labelOf(type)}</Badge>
        )}
      </div>
      <Loading id={shapeId} loading={list.isPending} label="Loading models">
        {(list.isError || shown.length === 0) && !list.isPending ? (
          <EmptyState>{list.isError ? errorMessage(list.error) : emptyText(props.name, type, filter)}</EmptyState>
        ) : (
          <Table aria-label="Models">
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Features</TableHead>
                <TableHead className="text-right">Released</TableHead>
                <TableHead className="text-right">Context</TableHead>
                <TableHead className="text-right">Input /1M</TableHead>
                <TableHead className="text-right">Output /1M</TableHead>
                <TableHead className="text-right">Cache read /1M</TableHead>
                <TableHead className="w-16">On</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((model) => (
                <TableRow key={model.id}>
                  <TableCell className="w-full max-w-0 whitespace-normal">
                    <ModelName model={model} />
                  </TableCell>
                  <TableCell>
                    <Features model={model} />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {released(model.released)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{tokens(model.context)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price?.input)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price?.output)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(model.price?.cacheRead)}</TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${model.name} on`}
                      checked={model.enabled}
                      disabled={!data.canManage}
                      onCheckedChange={(enabled) =>
                        update.mutate(
                          { id: props.providerId, models: [{ id: model.id, enabled }] },
                          { onError: failed },
                        )
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Loading>
    </section>
  )
}

function KeySection(props: { provider: ProviderInfo; onConnect: () => void; onRemove: () => void }) {
  const key = props.provider.key
  return (
    <section aria-label="API key" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">API key</h2>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        {key ? (
          <span>
            <span className="font-mono">…{key.last4}</span> · Tested {formatDateTime(key.testedAt)}
            {key.savedBy?.name ? ` · ${key.savedBy.name}` : ""}
          </span>
        ) : (
          <span>No key. Your organization pays {props.provider.name} for these models.</span>
        )}
        {props.provider.canManage ? (
          <span className="flex gap-1">
            <Button size="sm" variant="outline" onClick={props.onConnect}>
              <IconKey />
              {key ? "Replace key" : "Add key"}
            </Button>
            {key ? (
              <Button size="sm" variant="ghost" onClick={props.onRemove}>
                Remove key
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
    </section>
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
      {connection.limits.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {connection.canReconnect ? "Sign in again to keep using it." : "Usage appears after the first request."}
        </p>
      ) : (
        <SubscriptionLimits limits={connection.limits} />
      )}
    </Card>
  )
}

function Subscriptions(props: {
  provider: ProviderInfo
  onSignIn: (connectionId?: string) => void
  onRename: (id: string, label: string) => Promise<unknown>
  onRemove: (connection: RenInferenceConnection) => void
}) {
  const provider = props.provider
  return (
    <section aria-label="Subscriptions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Subscriptions</h2>
        <Button size="sm" variant="outline" onClick={() => props.onSignIn()}>
          <IconPlus />
          {signIn[provider.id] ?? `Connect ${provider.name}`}
        </Button>
      </div>
      {provider.id === "openai" && provider.canManage ? <ChatGptGuide /> : null}
      {provider.seats.length === 0 ? (
        <p className="text-xs text-muted-foreground">No subscription yet. Any member can connect theirs.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {provider.seats.map((connection) => (
            <SeatCard
              key={connection.id}
              connection={connection}
              onReconnect={() => props.onSignIn(connection.id)}
              onRename={(label) => props.onRename(connection.id, label)}
              onRemove={() => props.onRemove(connection)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ProviderControls(props: { provider: ProviderInfo }) {
  const { api } = RouterContext.useRouterContext()
  const update = useMutation(api.provider.update.mutationOptions())
  const provider = props.provider
  const failed = (error: unknown) => toast.error("Couldn’t change the provider", { description: errorMessage(error) })
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ProviderMark provider={provider.name} logo={provider.logo} letter className="size-6" />
      {provider.methods.length > 1 ? (
        <Select
          items={methods}
          value={provider.method}
          disabled={!provider.canManage}
          onValueChange={(value) => {
            if (value === "key" || value === "subscription")
              update.mutate({ id: provider.id, method: value }, { onError: failed })
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
      <label className="flex items-center gap-2 text-sm">
        <Switch
          aria-label={`${provider.name} on`}
          checked={provider.enabled}
          disabled={!provider.canManage}
          onCheckedChange={(enabled) => update.mutate({ id: provider.id, enabled }, { onError: failed })}
        />
        {provider.enabled ? "On" : "Off"}
      </label>
    </div>
  )
}

function ProviderConnection(props: { provider: ProviderInfo }) {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const removeKey = useMutation(api.provider.key.remove.mutationOptions())
  const connectSeat = useMutation(api["ren-inference"].connect.mutationOptions())
  const rename = useMutation(api["ren-inference"].connection.rename.mutationOptions())
  const removeSeat = useMutation(api["ren-inference"].connection.remove.mutationOptions())
  const [connecting, setConnecting] = useState(false)
  const [removing, setRemoving] = useState<{ title: string; run: () => Promise<unknown> }>()
  const provider = props.provider
  const failed = (action: string) => (error: unknown) => toast.error(action, { description: errorMessage(error) })
  const startSignIn = (connectionId?: string) =>
    connectSeat.mutate(
      { returnUrl: `${platform.appUrl}/settings/providers/${provider.id}`, ...(connectionId && { connectionId }) },
      {
        onSuccess: (result) => {
          platform.openExternal(result.url)
          toast("Opened the sign-in in a new tab", { description: "Ren lists the subscription once you finish there." })
        },
        onError: failed("Couldn’t start the sign-in"),
      },
    )
  return (
    <div className="flex flex-col gap-6">
      {provider.methods.includes("key") ? (
        <KeySection
          provider={provider}
          onConnect={() => setConnecting(true)}
          onRemove={() =>
            setRemoving({
              title: `Remove the ${provider.name} key?`,
              run: () => removeKey.mutateAsync({ id: provider.id }, { onError: failed("Couldn’t remove the key") }),
            })
          }
        />
      ) : null}
      {provider.methods.includes("subscription") ? (
        <Subscriptions
          provider={provider}
          onSignIn={startSignIn}
          onRename={(seat, label) => rename.mutateAsync({ id: seat, label }, { onError: failed("Couldn’t rename") })}
          onRemove={(connection) =>
            setRemoving({
              title: `Remove ${connection.label}?`,
              run: () => removeSeat.mutateAsync({ id: connection.id }, { onError: failed("Couldn’t remove") }),
            })
          }
        />
      ) : null}
      {connecting ? (
        <ConnectDialog
          provider={provider}
          onOpenChange={(open) => {
            if (!open) setConnecting(false)
          }}
          onConnected={() => setConnecting(false)}
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
    </div>
  )
}

export function ProviderPage() {
  const { api } = RouterContext.useRouterContext()
  const id = route.useParams({ select: (params) => params.id })
  const list = useQuery({ ...api.provider.list.queryOptions(), retry: false })
  const provider = list.data?.providers.find((each) => each.id === id)
  const name = provider?.name ?? "Provider"
  return (
    <Page
      title={name}
      description={
        provider?.builtIn
          ? "Built in: your organization uses these models without a key."
          : "Turn the provider and each of its models on or off. Only models that are on reach chats."
      }
      width="wide"
      back={
        <Link
          to="/settings/providers"
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "px-0 text-muted-foreground has-[>svg]:px-0",
          })}
        >
          <IconArrowLeft />
          Back to providers
        </Link>
      }
      aside={provider ? <ProviderControls provider={provider} /> : null}
    >
      {list.isError ? <EmptyState>{errorMessage(list.error)}</EmptyState> : null}
      {provider && !provider.builtIn ? <ProviderConnection provider={provider} /> : null}
      {provider && !provider.enabled ? (
        <p className="text-sm text-muted-foreground">Off. Its models are not in your team’s pickers.</p>
      ) : null}
      <Models providerId={id} name={name} />
    </Page>
  )
}
