import { Skeleton } from "@ren/ui/skeleton"
import { EmptyState } from "../../components/empty-state.js"
import { useState } from "react"
import type { RenInferenceConnection } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconChevronDown, IconExternalLink, IconInfoCircle, IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Link } from "@ren/ui/link"
import { cn } from "cn"
import { Card } from "@ren/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Progress } from "@ren/ui/progress"
import { formatCountdown, formatDateTime } from "@ren/ui/time"
import { Tabs } from "@ren/ui/tabs"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { EditableText } from "../../components/editable-text.js"
import { Page, PageTabsList, PageTabsTrigger } from "../../components/page.js"
import { ProviderMark } from "../../components/provider-mark.js"
import { StatusBadge } from "../../components/status-badge.js"
import { useNow } from "../../lib/use-now.js"
import { useCanAdminister } from "../../lib/use-organization.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"

type ProviderConnection = RenInferenceConnection

const providers = [
  { name: "Anthropic", product: "Claude" },
  { name: "OpenAI", product: "ChatGPT" },
]

function NoSubscriptions(props: { product: string; unavailable: boolean; onConnect: (() => void) | undefined }) {
  if (props.unavailable) return <EmptyState>Subscriptions aren’t available on this server yet.</EmptyState>
  return (
    <EmptyState
      action={
        props.onConnect ? (
          <Button variant="outline" onClick={props.onConnect}>
            <IconPlus />
            Connect {props.product}
          </Button>
        ) : null
      }
    >
      {`No ${props.product} subscriptions yet`}
    </EmptyState>
  )
}

function SubscriptionList(props: {
  loading: boolean
  rows: ReadonlyArray<ProviderConnection>
  product: string
  unavailable: boolean
  onConnect: (() => void) | undefined
  onReconnect: (connection: ProviderConnection) => void
  onRename: (id: string, label: string) => Promise<unknown>
  onRemove: (connection: ProviderConnection) => void
}) {
  if (props.loading)
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    )
  if (props.rows.length === 0)
    return <NoSubscriptions product={props.product} unavailable={props.unavailable} onConnect={props.onConnect} />
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {props.rows.map((connection, index) => (
        <SubscriptionCard
          key={connection.id}
          connection={connection}
          index={index}
          onReconnect={() => props.onReconnect(connection)}
          onRename={(label) => props.onRename(connection.id, label)}
          onRemove={() => props.onRemove(connection)}
        />
      ))}
    </div>
  )
}

export function ProvidersPage() {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const isAdmin = useCanAdminister()
  const list = useQuery({ ...api["ren-inference"].connection.list.queryOptions(), retry: false })
  const connections = list.data ?? []
  const [tab, setTab] = useState(providers.at(0)?.name ?? "Anthropic")
  const [removing, setRemoving] = useState<ProviderConnection>()
  const connectMutation = useMutation(api["ren-inference"].connect.mutationOptions())
  const rename = useMutation(api["ren-inference"].connection.rename.mutationOptions())
  const remove = useMutation(api["ren-inference"].connection.remove.mutationOptions())
  const loading = list.isPending
  const unavailable = list.isError
  const connect = (provider: string, connectionId?: string) => {
    setTab(provider)
    connectMutation.mutate(
      { returnUrl: `${platform.appUrl}/settings/providers`, ...(connectionId && { connectionId }) },
      {
        onSuccess: (result) => {
          platform.openExternal(result.url)
          toast(
            `Opened ${providers.find((each) => each.name === provider)?.product ?? provider} sign-in in a new tab`,
            {
              description: "Ren lists the subscription once you finish there.",
            },
          )
        },
        onError: (error) => toast.error("Couldn’t start the sign-in", { description: errorMessage(error) }),
      },
    )
  }
  const rows = connections.filter((each) => each.providerName === tab)
  const product = providers.find((provider) => provider.name === tab)?.product ?? tab
  return (
    <Page
      title="Providers"
      description="Subscriptions your agents run on."
      aside={isAdmin ? <ConnectMenu onSelect={connect} /> : undefined}
      leading={
        <Tabs value={tab} onValueChange={setTab}>
          <PageTabsList aria-label="Providers">
            {providers.map((provider) => (
              <PageTabsTrigger
                key={provider.name}
                value={provider.name}
                count={connections.filter((each) => each.providerName === provider.name).length}
              >
                <ProviderMark provider={provider.name} />
                {provider.name}
              </PageTabsTrigger>
            ))}
          </PageTabsList>
        </Tabs>
      }
    >
      <section key={tab} aria-live="polite" className="flex flex-col gap-3">
        {isAdmin && tab === "OpenAI" ? <ChatGptGuide /> : null}
        <SubscriptionList
          loading={loading}
          rows={rows}
          product={product}
          unavailable={unavailable}
          onConnect={isAdmin ? () => connect(tab) : undefined}
          onReconnect={(connection) => connect(connection.providerName, connection.id)}
          onRename={(id: string, label: string) =>
            rename.mutateAsync(
              { id, label },
              { onError: (error) => toast.error("Couldn’t rename", { description: errorMessage(error) }) },
            )
          }
          onRemove={setRemoving}
        />
      </section>
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(undefined)
          }}
          confirmation={{
            title: `Remove ${removing.label}?`,
            description: "New requests stop using it right away.",
            action: "Remove",
          }}
          onConfirm={() =>
            ((connection: ProviderConnection) =>
              remove.mutateAsync(
                { id: connection.id },
                {
                  onSuccess: () => toast.success(`${connection.label} removed`),
                  onError: (error) => toast.error("Couldn’t remove", { description: errorMessage(error) }),
                },
              ))(removing)
          }
        />
      ) : null}
    </Page>
  )
}

function ConnectMenu(props: { onSelect: (provider: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}>
        <IconPlus />
        Connect
        <IconChevronDown className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          {providers.map((provider) => (
            <DropdownMenuItem key={provider.name} onClick={() => props.onSelect(provider.name)}>
              <ProviderMark provider={provider.name} />
              {provider.product}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ChatGptGuide() {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <IconInfoCircle className="mt-0.5 size-4 shrink-0" />
      <span>
        Before you connect, turn on <span className="text-foreground">Enable device code authorization for Codex</span>{" "}
        in your{" "}
        <Link
          href="https://chatgpt.com/#settings/Security"
          external
          className="inline-flex items-center gap-1 font-normal text-foreground underline underline-offset-2"
        >
          ChatGPT security settings
          <IconExternalLink className="size-3" />
        </Link>
        .
      </span>
    </p>
  )
}

const enterDelays = [
  "delay-0",
  "delay-30",
  "delay-60",
  "delay-90",
  "delay-120",
  "delay-150",
  "delay-180",
  "delay-210",
  "delay-240",
]

function SubscriptionCard(props: {
  connection: ProviderConnection
  index: number
  onReconnect: () => void
  onRename: (label: string) => Promise<unknown>
  onRemove: () => void
}) {
  const connection = props.connection
  const now = useNow()
  return (
    <Card
      className={cn(
        "relative animate-in gap-3 border px-4 ring-0 duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] fade-in-0 fill-mode-both slide-in-from-bottom-1 motion-reduce:animate-none",
        enterDelays[Math.min(props.index, enterDelays.length - 1)],
      )}
    >
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
              Reconnect
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
        <ul className="flex flex-col gap-3">
          {connection.meters.map((meter) => (
            <li key={meter.key} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate">{meter.title}</span>
                <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <span className="font-medium">{meter.percent === null ? "—" : `${meter.percent}%`}</span>
                  {meter.resetsAt && Date.parse(meter.resetsAt) > now ? (
                    <span className="text-muted-foreground" title={`Resets ${formatDateTime(meter.resetsAt)}`}>
                      {formatCountdown(meter.resetsAt, now)}
                    </span>
                  ) : null}
                </span>
              </div>
              <Progress
                value={meter.percent ?? 0}
                aria-label={meter.title}
                className="**:data-[slot=progress-indicator]:bg-chart-1 **:data-[slot=progress-track]:bg-secondary"
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
