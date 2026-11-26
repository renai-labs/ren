import { useDeferredValue, useState } from "react"
import type { ProviderInfo, ProviderPage } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconKey, IconSearch } from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { Button, buttonVariants } from "@ren/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { Loading } from "@ren/ui/loading"
import { EmptyState } from "../../components/empty-state.js"
import { Page, useShapeId } from "../../components/page.js"
import { ProviderMark } from "../../components/provider-mark.js"
import { RouterContext } from "../../lib/router-context.js"
import { ConnectDialog } from "./connect-dialog.js"
import { ModelTypes } from "./model-types.js"
import { errorMessage } from "../../lib/errors.js"

const sample: ProviderPage = {
  providers: Array.from({ length: 6 }, (_, index) => ({
    id: `sample-${index}`,
    name: "Provider",
    mark: "sample",
    payer: "customer",
    builtIn: false,
    added: false,
    enabled: true,
    methods: [],
    fields: [],
    key: null,
    seats: [],
    modelTypes: { chat: 10 },
    canManage: false,
  })),
}

const normalized = (value: string) => value.trim().toLowerCase()

// oxlint-disable-next-line ren/no-comments -- Providers §6.4.1: a provider reaches chats only while it is connected: built in, a saved key, or a member's subscription.
const connected = (provider: ProviderInfo) => {
  if (provider.builtIn) return true
  return provider.method === "subscription" ? provider.seats.length > 0 : provider.key !== null
}

function Connection(props: { provider: ProviderInfo }) {
  const provider = props.provider
  if (provider.builtIn) return <span>Built in</span>
  if (provider.key && provider.method !== "subscription")
    return (
      <span>
        Key <span className="font-mono">…{provider.key.last4}</span>
      </span>
    )
  return <span>{provider.seats.length === 1 ? "1 subscription" : `${provider.seats.length} subscriptions`}</span>
}

function ProviderCard(props: { provider: ProviderInfo; onConnect: () => void }) {
  const provider = props.provider
  const count = ModelTypes.total(provider.modelTypes)
  return (
    <li
      aria-label={provider.name}
      className="relative flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderMark provider={provider.name} logo={provider.logo} letter className="size-6" />
          <Link
            to="/settings/providers/$id"
            params={{ id: provider.id }}
            className="truncate text-sm font-medium after:absolute after:inset-0 after:rounded-xl"
          >
            {provider.name}
          </Link>
        </div>
        {connected(provider) ? (
          <Badge variant={provider.enabled ? "secondary" : "outline"}>{provider.enabled ? "On" : "Off"}</Badge>
        ) : null}
        {!connected(provider) &&
        (provider.methods.includes("subscription") || (provider.canManage && provider.fields.length > 0)) ? (
          <Button
            size="sm"
            variant="outline"
            className="relative z-10"
            aria-label={`Connect ${provider.name}`}
            onClick={props.onConnect}
          >
            Connect
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="underline decoration-dotted underline-offset-2">{ModelTypes.countText(count)}</span>
        {connected(provider) ? (
          <>
            {" · "}
            <Connection provider={provider} />
          </>
        ) : null}
      </p>
    </li>
  )
}

export function ProvidersPage() {
  const { api } = RouterContext.useRouterContext()
  const list = useQuery({ ...api.provider.list.queryOptions(), retry: false })
  const [query, setQuery] = useState("")
  const [connecting, setConnecting] = useState<ProviderInfo>()
  const shapeId = useShapeId("providers")
  const search = normalized(useDeferredValue(query))
  const shown = (list.data ?? sample).providers.filter(
    (provider) => !search || normalized(provider.name).includes(search) || normalized(provider.id).includes(search),
  )
  return (
    <Page
      title="Providers"
      description="The models your team’s agents run on: Ren’s, your own keys and your team’s subscriptions."
      width="wide"
      aside={
        <Link to="/settings/providers/keys" className={buttonVariants({ variant: "outline" })}>
          <IconKey />
          Inference keys
        </Link>
      }
    >
      <InputGroup>
        <InputGroupAddon>
          <IconSearch />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search providers"
          placeholder="Search for provider…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </InputGroup>
      <Loading id={shapeId} loading={list.isPending} label="Loading providers">
        {list.isError ? <EmptyState>{errorMessage(list.error)}</EmptyState> : null}
        {!list.isError && shown.length === 0 && !list.isPending ? (
          <EmptyState
            action={
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          >
            {`No provider matches “${query}”`}
          </EmptyState>
        ) : null}
        {!list.isError && shown.length > 0 ? (
          <ul aria-label="Providers" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} onConnect={() => setConnecting(provider)} />
            ))}
          </ul>
        ) : null}
      </Loading>
      {connecting ? (
        <ConnectDialog
          provider={connecting}
          choose
          onOpenChange={(open) => {
            if (!open) setConnecting(undefined)
          }}
          onConnected={() => setConnecting(undefined)}
        />
      ) : null}
    </Page>
  )
}
