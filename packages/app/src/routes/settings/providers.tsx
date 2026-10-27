import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ren/empty-state"
import { useState } from "react"
import type { RenInferenceConnection } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  IconChevronDown,
  IconExternalLink,
  IconInfoCircle,
  IconPlus,
  IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Tabs } from "@/components/ui/tabs"
import { ConfirmDialog } from "@/components/ren/confirm-dialog"
import { EditableText } from "@/components/ren/editable-text"
import { Page, PageTabsList, PageTabsTrigger } from "@/components/ren/page"
import { ProviderMark } from "@/components/ren/provider-mark"
import { StatusBadge } from "@/components/ren/status-badge"
import { useNow } from "@/hooks/use-now"
import { useCanAdminister } from "@/hooks/use-organization"
import { api, appUrl, errorMessage } from "@/lib/api"

type ProviderConnection = RenInferenceConnection

const providers = [
  { name: "Anthropic", product: "Claude" },
  { name: "OpenAI", product: "ChatGPT" },
]

const relative = new Intl.RelativeTimeFormat("en", {
  style: "narrow",
  numeric: "auto" })

const resetsIn = (value: string, now: number) => {
  const minutes = Math.round((Date.parse(value) - now) / 60_000)
  if (minutes < 60) return relative.format(minutes, "minute")
  if (minutes < 24 * 60)
    return relative.format(Math.round(minutes / 60), "hour")
  return relative.format(Math.round(minutes / (24 * 60)), "day")
}

function useProvidersPage() {
  const isAdmin = useCanAdminister()
  const list = useQuery({ ...api["ren-inference"].connection.list.queryOptions(), retry: false })
  const connections = list.data ?? []
  const [tab, setTab] = useState(providers.at(0)?.name ?? "Anthropic")
  const [removing, setRemoving] = useState<ProviderConnection>()
  const connectMutation = useMutation(api["ren-inference"].connect.mutationOptions())
  const rename = useMutation(api["ren-inference"].connection.rename.mutationOptions())
  const remove = useMutation(api["ren-inference"].connection.remove.mutationOptions())
  return {
    isAdmin,
    loading: list.isPending,
    unavailable: list.isError,
    connections,
    tab,
    setTab,
    removing,
    setRemoving,
    connect: (provider: string, connectionId?: string) => {
      setTab(provider)
      connectMutation.mutate(
        { returnUrl: `${appUrl}/settings/providers`, ...(connectionId && { connectionId }) },
        {
          onSuccess: (result) => {
            window.open(result.url, "_blank", "noopener,noreferrer")
            toast(`Opened ${providers.find((each) => each.name === provider)?.product ?? provider} sign-in in a new tab`, {
              description: "Ren lists the subscription once you finish there." })
          },
          onError: (error) => toast.error("Couldn’t start the sign-in", { description: errorMessage(error) }) },
      )
    },
    rename: (id: string, label: string) =>
      rename.mutateAsync(
        { id, label },
        { onError: (error) => toast.error("Couldn’t rename", { description: errorMessage(error) }) },
      ),
    remove: (connection: ProviderConnection) =>
      remove.mutateAsync(
        { id: connection.id },
        {
          onSuccess: () => toast.success(`${connection.label} removed`),
          onError: (error) => toast.error("Couldn’t remove", { description: errorMessage(error) }) },
      ) }
}

export function ProvidersPage() {
  const page = useProvidersPage()
  const isAdmin = page.isAdmin
  const connections = page.connections
  const tab = page.tab
  const setTab = page.setTab
  const removing = page.removing
  const setRemoving = page.setRemoving
  const connect = page.connect
  const rows = connections.filter((each) => each.providerName === tab)
  const product =
    providers.find((provider) => provider.name === tab)?.product ?? tab
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
                count={
                  connections.filter(
                    (each) => each.providerName === provider.name
                  ).length
                }
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
        {page.loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            action={
              isAdmin && !page.unavailable ? (
                <Button variant="outline" size="sm" onClick={() => connect(tab)}>
                  <IconPlus />
                  Connect {product}
                </Button>
              ) : null
            }
          >
            {page.unavailable ? "Subscriptions aren’t available on this server yet." : `No ${product} subscriptions yet`}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map((connection, index) => (
              <SubscriptionCard
                key={connection.id}
                connection={connection}
                index={index}
                onReconnect={() => connect(connection.providerName, connection.id)}
                onRename={(label) => page.rename(connection.id, label)}
                onRemove={() => setRemoving(connection)}
              />
            ))}
          </div>
        )}
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
            action: "Remove" }}
          onConfirm={() => page.remove(removing)}
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
          <DropdownMenuItem
            key={provider.name}
            onClick={() => props.onSelect(provider.name)}
          >
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
        Before you connect, turn on{" "}
        <span className="text-foreground">
          Enable device code authorization for Codex
        </span>{" "}
        in your{" "}
        <a
          href="https://chatgpt.com/#settings/Security"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-foreground underline underline-offset-2"
        >
          ChatGPT security settings
          <IconExternalLink className="size-3" />
        </a>
        .
      </span>
    </p>
  )
}

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
      className="relative animate-in gap-3 border px-4 ring-0 duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] fade-in-0 fill-mode-both slide-in-from-bottom-1 motion-reduce:animate-none"
      style={{ animationDelay: `${Math.min(props.index * 30, 240)}ms` }}
    >
      <div
        className={
          connection.canReconnect
            ? "flex min-w-0 flex-col gap-1 pr-36"
            : "flex min-w-0 flex-col gap-1 pr-8"
        }
      >
        <span className="truncate text-sm font-medium">
          {connection.canManage ? (
            <EditableText value={connection.label} label="subscription name" required onCommit={props.onRename} />
          ) : (
            connection.label
          )}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge tone={connection.status.tone}>
            {connection.status.label}
          </StatusBadge>
          {connection.plan ? <span>· {connection.plan}</span> : null}
        </span>
      </div>
      {connection.canManage ? (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
          {connection.canReconnect ? (
            <Button
              variant="secondary"
              size="xs"
              className="h-6.5"
              onClick={props.onReconnect}
            >
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
          {connection.canReconnect
            ? "Sign in again to keep using it."
            : "Usage appears after the first request."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {connection.meters.map((meter) => (
            <li key={meter.key} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate">{meter.title}</span>
                <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <span className="font-medium">
                    {meter.percent === null ? "—" : `${meter.percent}%`}
                  </span>
                  {meter.resetsAt && Date.parse(meter.resetsAt) > now ? (
                    <span
                      className="text-muted-foreground"
                      title={`Resets ${new Date(meter.resetsAt).toLocaleString("en")}`}
                    >
                      {resetsIn(meter.resetsAt, now)}
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
