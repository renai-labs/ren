import { useDeferredValue, useState } from "react"
import type { ProviderAvailable, ProviderPage } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { IconArrowLeft, IconSearch } from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { Button, buttonVariants } from "@ren/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { Loading } from "@ren/ui/loading"
import { EmptyState } from "../../components/empty-state.js"
import { Page, useShapeId } from "../../components/page.js"
import { ProviderMark } from "../../components/provider-mark.js"
import { RouterContext } from "../../lib/router-context.js"
import { ConnectDialog } from "./connect-dialog.js"

const normalized = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "")

const sample: ProviderPage = {
  providers: [],
  available: Array.from({ length: 9 }, (_, index) => ({
    id: `sample-${index}`,
    name: "Provider",
    mark: "sample",
    modelCount: 10,
    fields: [],
    added: false,
  })),
}

export function ConnectProviderPage() {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const list = useQuery(api.provider.list.queryOptions())
  const [query, setQuery] = useState("")
  const [connecting, setConnecting] = useState<ProviderAvailable>()
  const shapeId = useShapeId("connect-provider")
  const search = normalized(useDeferredValue(query))
  const shown = (list.data ?? sample).available.filter(
    (provider) => !search || normalized(provider.name).includes(search) || normalized(provider.id).includes(search),
  )
  return (
    <Page
      title="Connect provider"
      description="Connect a provider with your organization’s own key. You pay the provider."
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
    >
      <InputGroup>
        <InputGroupAddon>
          <IconSearch />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search providers"
          placeholder="Groq"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </InputGroup>
      <Loading id={shapeId} loading={list.isPending} label="Loading providers">
        {shown.length === 0 && !list.isPending ? (
          <EmptyState
            action={
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          >
            {`No provider matches “${query}”`}
          </EmptyState>
        ) : (
          <ul aria-label="Providers you can connect" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((provider) => (
              <li key={provider.id} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
                <div className="flex min-w-0 items-center gap-2">
                  <ProviderMark provider={provider.name} />
                  <span className="truncate text-sm font-medium">{provider.name}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {provider.modelCount === 1 ? "1 model" : `${provider.modelCount} models`}
                  </span>
                  {provider.added ? (
                    <Badge variant="secondary">Added</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Connect ${provider.name}`}
                      onClick={() => setConnecting(provider)}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Loading>
      {connecting ? (
        <ConnectDialog
          provider={connecting}
          onOpenChange={(open) => {
            if (!open) setConnecting(undefined)
          }}
          onConnected={() => void navigate({ to: "/settings/providers" })}
        />
      ) : null}
    </Page>
  )
}
