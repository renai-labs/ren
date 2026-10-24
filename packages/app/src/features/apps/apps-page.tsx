import type { AppProfileInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { List } from "@ren/ui/list"
import { PageShell } from "@ren/ui/page-shell"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { ProfileDialog } from "../../components/profile-dialog.js"
import { Profiles } from "../../components/profiles.js"

const page = { page: 1, pageSize: Pagination.maximumPageSize }

const reachOf = (profile: AppProfileInfo) => {
  if (profile.kind === "private") return "Private"
  if (profile.allSpaces) return "Every space"
  const count = profile.spaces.length + profile.hiddenSpaces
  return count === 1 ? "1 space" : `${count} spaces`
}

// oxlint-disable-next-line ren/no-comments -- profiles.md §9 rule 1 (P9, P12, P25): the org's apps and registry apps, each with the profiles the person sees, their gaps and the parts Ren skips. "New profile" is the first entry point.
export function AppsPage() {
  const context = RouterContext.useRouterContext()
  const apps = useQuery(context.api.app.list.queryOptions(page))
  const registry = useQuery(context.api["app-registry"].list.queryOptions(page))
  const profiles = useQuery({ ...context.api["app-profile"].list.queryOptions(page), refetchOnWindowFocus: "always" })
  const [opened, setOpened] = useState<{ readonly appId: string; readonly profileId?: string }>()
  const listed = [
    ...(apps.data?.items ?? []).map((app) => ({ id: app.id, name: app.name, description: app.description })),
    ...(registry.data?.items ?? []).map((app) => ({ id: app.id, name: app.name, description: app.description })),
  ]
  const byApp = Map.groupBy(profiles.data?.items ?? [], (profile) => profile.appId)
  return (
    <PageShell.Root title="Apps" subtitle="Each profile is one set of accounts for an app. Spaces use the profiles they reach.">
      {listed.map((app) => (
        <List.Root key={app.id} label={app.name}>
          <List.Section title={app.name} appearance="eyebrow">
            {(byApp.get(app.id) ?? []).map((profile) => {
              const gaps = Profiles.gaps(profile).length
              return (
                <List.Item
                  key={profile.id}
                  title={profile.name}
                  description={[reachOf(profile), ...profile.skipped.map((skipped) => `${skipped.slug} skipped: also in ${skipped.also}`)].join(" · ")}
                  trailing={
                    <span className="flex items-center gap-2">
                      <Badge tone={gaps ? "warning" : "success"}>{gaps ? `${gaps} not connected` : "Connected"}</Badge>
                      <Button
                        appearance="secondary"
                        size="small"
                        onClick={() => setOpened({ appId: app.id, profileId: profile.id })}
                      >
                        Open profile
                      </Button>
                    </span>
                  }
                />
              )
            })}
            <List.Item
              title={app.description}
              trailing={
                <Button
                  appearance="secondary"
                  size="small"
                  leadingIcon={<Icon glyph="Plus" />}
                  onClick={() => setOpened({ appId: app.id })}
                >
                  New profile
                </Button>
              }
            />
          </List.Section>
        </List.Root>
      ))}
      {opened ? (
        <ProfileDialog
          appId={opened.appId}
          {...(opened.profileId && { profileId: opened.profileId })}
          onClose={() => setOpened(undefined)}
        />
      ) : null}
    </PageShell.Root>
  )
}
