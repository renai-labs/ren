import { useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconChevronRight } from "@tabler/icons-react"
import { ChannelMark } from "../../components/channel-mark.js"
import { Page, Row, Rows, Section } from "../../components/page.js"
import { Channels } from "../../lib/channels.js"
import { RouterContext } from "../../lib/router-context.js"

const connectionText = (offered: boolean) => (offered ? "Not connected" : "Not set up on this server")

export function ChannelsSettingsPage() {
  const { api } = RouterContext.useRouterContext()
  const installs = useSuspenseQuery(Channels.installsOptions(api)).data.items
  const offered = useSuspenseQuery(api["channel-connect"]["channel-provider"].list.queryOptions()).data.items
  const sections = Channels.sections.map((section) => ({
    title: section.title,
    description: section.description,
    rows: section.providers.map((id) => ({
      provider: Channels.byId[id],
      installed: installs.some((install) => install.provider === id),
      offered: offered.some((provider) => provider.id === id),
    })),
  }))
  return (
    <Page title="@Ren" description="Invoke Ren from where your team already works.">
      {sections.map((section) => (
        <Section key={section.title} title={section.title} description={section.description}>
          <Rows>
            {section.rows.map((row) => (
              <Row
                key={row.provider.id}
                title={row.provider.title}
                media={<ChannelMark provider={row.provider.id} className="size-7" />}
                description={
                  row.installed ? <span className="text-chart-2">Connected</span> : connectionText(row.offered)
                }
                render={
                  row.installed || row.offered ? (
                    <Link to="/settings/channels/$provider" params={{ provider: row.provider.id }} />
                  ) : undefined
                }
              >
                {row.installed || row.offered ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    {row.installed ? "Configure" : `Connect ${row.provider.title}`}
                    <IconChevronRight className="size-4" />
                  </span>
                ) : null}
              </Row>
            ))}
          </Rows>
        </Section>
      ))}
    </Page>
  )
}
