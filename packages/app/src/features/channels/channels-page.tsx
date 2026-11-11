import { useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconChevronRight } from "@tabler/icons-react"
import { ChannelMark } from "../../components/channel-mark.js"
import { EmptyState } from "../../components/empty-state.js"
import { Page, Row, Rows, Section } from "../../components/page.js"
import { Channels } from "../../lib/channels.js"
import { RouterContext } from "../../lib/router-context.js"

export function ChannelsSettingsPage() {
  const { api } = RouterContext.useRouterContext()
  const installs = useSuspenseQuery(Channels.installsOptions(api)).data.items
  const offered = useSuspenseQuery(api["channel-connect"]["channel-provider"].list.queryOptions()).data.items
  const sections = Channels.sections
    .map((section) => ({
      title: section.title,
      rows: section.providers
        .map((id) => ({
          provider: Channels.byId[id],
          installed: installs.some((install) => install.provider === id),
          offered: offered.some((provider) => provider.id === id),
        }))
        .filter((row) => row.installed || row.offered),
    }))
    .filter((section) => section.rows.length > 0)
  return (
    <Page title="Channels" description="Invoke Ren from where your team already works.">
      {sections.length === 0 ? <EmptyState>No channels are set up on this server yet.</EmptyState> : null}
      {sections.map((section) => (
        <Section key={section.title} title={section.title}>
          <Rows>
            {section.rows.map((row) => (
              <Row
                key={row.provider.id}
                title={row.provider.title}
                media={<ChannelMark provider={row.provider.id} className="size-6" />}
                description={row.installed ? <span className="text-chart-2">Connected</span> : "Not connected"}
                render={<Link to="/settings/channels/$provider" params={{ provider: row.provider.id }} />}
              >
                <span className="flex items-center gap-1 text-muted-foreground">
                  {row.installed ? "Configure" : null}
                  <IconChevronRight className="size-4" />
                </span>
              </Row>
            ))}
          </Rows>
        </Section>
      ))}
    </Page>
  )
}
