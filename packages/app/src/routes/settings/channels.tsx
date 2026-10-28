import { useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconChevronRight } from "@tabler/icons-react"
import { ChannelMark } from "@/components/ren/channel-mark"
import { Page, Row, Rows, Section } from "@/components/ren/page"
import { api } from "@/lib/api"
import { Channels } from "@/lib/channels"

function useChannelsPage() {
  const installs = useSuspenseQuery(Channels.installsOptions()).data.items
  const offered = useSuspenseQuery(api["channel-connect"]["channel-provider"].list.queryOptions()).data.items
  return {
    sections: Channels.sections.map((section) => ({
      title: section.title,
      description: section.description,
      rows: section.providers.map((id) => ({
        provider: Channels.byId[id],
        installed: installs.some((install) => install.provider === id),
        offered: offered.some((provider) => provider.id === id),
      })),
    })),
  }
}

export function ChannelsSettingsPage() {
  const page = useChannelsPage()
  return (
    <Page title="@Ren" description="Invoke Ren from where your team already works.">
      {page.sections.map((section) => (
        <Section key={section.title} title={section.title} description={section.description}>
          <Rows>
            {section.rows.map((row) => (
              <Row
                key={row.provider.id}
                title={row.provider.title}
                media={<ChannelMark provider={row.provider.id} className="size-7" />}
                description={
                  row.installed ? (
                    <span className="text-chart-2">Connected</span>
                  ) : row.offered ? (
                    "Not connected"
                  ) : (
                    "Not set up on this server"
                  )
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
