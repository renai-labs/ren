import type { ChannelInstallInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Icon } from "@ren/ui/icon"
import { List } from "@ren/ui/list"
import { PageShell } from "@ren/ui/page-shell"
import { ProgressIndicator } from "@ren/ui/progress-indicator"
import { SearchField } from "@ren/ui/search-field"
import { StateMessage } from "@ren/ui/state-message"
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
    <PageShell.Root
      title="@Ren"
      subtitle="Invoke Ren from where your team already works."
      toolbar={<SearchField.Root value={props.query} onValueChange={props.onQueryChange} label="Search channels" />}
    >
      {sections.map((section) => (
        <PageShell.Section key={section.category} title={section.title} description={section.description}>
          <List.Root frame="card" label={section.title}>
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
          </List.Root>
        </PageShell.Section>
      ))}
      {sections.length === 0 ? (
        <StateMessage
          state="no-results"
          title={`No channels match “${props.query.trim()}”`}
          onRetry={() => props.onQueryChange("")}
          retryLabel="Show all channels"
        />
      ) : null}
    </PageShell.Root>
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
  const item = {
    density: "spacious" as const,
    leading: <Icon glyph={props.provider.glyph} size="large" tone="primary" />,
    title: props.provider.title,
    description: (
      <Text purpose="caption" tone={busy ? "secondary" : status.tone} element="span">
        {busy ? "Checking…" : status.label}
      </Text>
    ),
    trailing: busy ? (
      <ProgressIndicator label="Checking" />
    ) : (
      <span className="flex items-center gap-1">
        {actionOf(props)}
        <Icon glyph="ChevronRight" tone="secondary" />
      </span>
    ),
  }
  if (busy) return <List.Item {...item} disabled />
  if (props.install && props.attention) return <List.Item {...item} onActivate={props.attention.act} />
  if (props.install)
    return (
      <List.Item
        {...item}
        render={<Link to="/settings/channels/$provider" params={{ provider: props.provider.id }} />}
      />
    )
  if (!props.available) return <List.Item {...item} trailing={undefined} disabled />
  return <List.Item {...item} onActivate={started.install} />
}
