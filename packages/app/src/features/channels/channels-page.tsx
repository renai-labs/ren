import type { ChannelInstallInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Button, buttonVariants } from "@ren/ui/button"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Page } from "@ren/ui/page"
import { SearchField } from "@ren/ui/search-field"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import type { TextTone } from "@ren/ui/text"
import { Search } from "@ren/util/search"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { RouterContext } from "../../lib/router-context.js"
import { Channels } from "./channels.js"
import { useAccountLink } from "../../lib/use-account-link.js"
import { useInstall } from "./use-install.js"

const page = { page: 1, pageSize: Pagination.maximumPageSize }

export function ChannelsPage(props: { query: string; onQueryChange: (query: string) => void }) {
  const context = RouterContext.useRouterContext()
  const installs = useQuery({
    ...context.api["channel-install"].list.queryOptions(page),
    refetchOnWindowFocus: "always",
  })
  const offered = useQuery(context.api["channel-connect"]["channel-provider"].list.queryOptions())
  const github = useAccountLink("github", "/settings/channels")
  const attention: Partial<Record<Channels.Provider, Attention>> = {
    ...(github.offered &&
      !github.loading &&
      !github.linked && {
        github: {
          label: "Connect your GitHub account",
          act: () => github.link.mutate(),
        },
      }),
  }
  const byProvider = new Map((installs.data?.items ?? []).map((install) => [install.provider, install]))
  const available = new Set((offered.data?.items ?? []).map((provider) => provider.id))
  const needle = props.query.trim().toLowerCase()
  const matching = Channels.providers.filter((provider) =>
    Search.matches([provider.title, provider.description], needle),
  )
  const byCategory = Map.groupBy(matching, (provider) => provider.category)
  const sections = Channels.sections.filter((section) => byCategory.has(section.category))
  return (
    <Page.Root
      title="@Ren"
      description="Invoke Ren from where your team already works."
      leading={<SearchField.Root value={props.query} onValueChange={props.onQueryChange} label="Search channels" />}
    >
      {sections.map((section) => (
        <Page.Section key={section.category} title={section.title} description={section.description}>
          <ItemGroup aria-label={section.title} className="gap-0 divide-y rounded-xl border bg-card">
            {(byCategory.get(section.category) ?? []).map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                install={byProvider.get(provider.id)}
                available={available.has(provider.id)}
                loading={installs.isLoading || offered.isLoading || (provider.id === "github" && github.link.isPending)}
                attention={attention[provider.id]}
              />
            ))}
          </ItemGroup>
        </Page.Section>
      ))}
      {sections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon glyph="Search" />
            </EmptyMedia>
            <EmptyTitle>No channels match “{props.query.trim()}”</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={() => props.onQueryChange("")}>
              Show all channels
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
    </Page.Root>
  )
}

interface Attention {
  readonly label: string
  readonly act: () => void
}

const actionOf = (row: {
  readonly provider: (typeof Channels.providers)[number]
  readonly install: ChannelInstallInfo | undefined
  readonly attention: Attention | undefined
}) => (row.install ? (row.attention?.label ?? "Configure") : `Install Ren on ${row.provider.title}`)

const statusOf = (row: {
  readonly install: ChannelInstallInfo | undefined
  readonly available: boolean
  readonly attention: Attention | undefined
}): { readonly label: string; readonly tone: TextTone } => {
  if (row.install && row.attention) return { label: "Needs attention", tone: "warning" }
  if (row.install) return { label: `Connected to ${row.install.name}`, tone: "success" }
  if (row.available) return { label: "Not connected", tone: "secondary" }
  return { label: "Not set up on this server", tone: "secondary" }
}

function ProviderRow(props: {
  provider: (typeof Channels.providers)[number]
  install: ChannelInstallInfo | undefined
  available: boolean
  loading: boolean
  attention: Attention | undefined
}) {
  const started = useInstall(props.provider.id, props.provider.title)
  const busy = props.loading || started.isPending
  const status = statusOf(props)
  const idle = !props.install && !props.available
  return (
    <Item
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Item renders a div inside the ItemGroup list
      role="listitem"
      className={idle ? "min-h-14 gap-x-6 px-4 py-3 opacity-50" : "min-h-14 gap-x-6 px-4 py-3"}
    >
      <ItemMedia>
        <Icon glyph={props.provider.glyph} size="large" tone="primary" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle>{props.provider.title}</ItemTitle>
        <ItemDescription className="text-xs">
          <Text purpose="caption" tone={busy ? "secondary" : status.tone} element="span">
            {busy ? "Checking…" : status.label}
          </Text>
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {busy ? <Spinner aria-label="Checking" /> : null}
        {busy || idle ? null : <ProviderAction {...props} onInstall={started.install} />}
      </ItemActions>
    </Item>
  )
}

function ProviderAction(props: {
  provider: (typeof Channels.providers)[number]
  install: ChannelInstallInfo | undefined
  attention: Attention | undefined
  onInstall: () => void
}) {
  const label = (
    <>
      {actionOf(props)}
      <Icon glyph="ChevronRight" data-icon="inline-end" />
    </>
  )
  if (props.install && !props.attention)
    return (
      <Link
        to="/settings/channels/$provider"
        params={{ provider: props.provider.id }}
        className={buttonVariants({ variant: "ghost", size: "xs", className: "h-6.5 text-muted-foreground" })}
      >
        {label}
      </Link>
    )
  return (
    <Button
      variant="ghost"
      size="xs"
      className="h-6.5 text-muted-foreground"
      onClick={props.install && props.attention ? props.attention.act : props.onInstall}
    >
      {label}
    </Button>
  )
}
