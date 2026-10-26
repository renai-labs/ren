import type { AppProfileInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Avatar } from "@ren/ui/avatar"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { List } from "@ren/ui/list"
import { Popover } from "@ren/ui/popover"
import { Select } from "@ren/ui/select"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { ProfileDialog } from "./profile-dialog.js"
import { Profiles } from "./profiles.js"

const page = { page: 1, pageSize: Pagination.maximumPageSize }

// oxlint-disable-next-line ren/no-comments -- profiles.md P15: the apps a chat reaches, with the accounts still missing. Each profile opens its dialog.
export function SessionAppsStrip(props: { readonly sessionId: string }) {
  const context = RouterContext.useRouterContext()
  const reach = useQuery({
    ...context.api["app-profile-reach"].session.profiles.queryOptions({ id: props.sessionId }),
    refetchOnWindowFocus: "always",
  })
  return <Strip profiles={reach.data?.profiles ?? []} />
}

// oxlint-disable-next-line ren/no-comments -- The same for a new chat of the caller in a space.
export function SpaceAppsStrip(props: { readonly spaceId: string }) {
  const context = RouterContext.useRouterContext()
  const reach = useQuery({
    ...context.api["app-profile-reach"].space.profiles.queryOptions({ id: props.spaceId }),
    refetchOnWindowFocus: "always",
  })
  return <Strip profiles={reach.data?.profiles ?? []} />
}

function Strip(props: { readonly profiles: ReadonlyArray<AppProfileInfo> }) {
  const context = RouterContext.useRouterContext()
  const apps = useQuery(context.api.app.list.queryOptions(page))
  const registry = useQuery(context.api["app-registry"].list.queryOptions(page))
  const [opened, setOpened] = useState<AppProfileInfo>()
  if (props.profiles.length === 0) return null
  const known = new Map(
    [...(apps.data?.items ?? []), ...(registry.data?.items ?? [])].map((app) => [app.id, app] as const),
  )
  const items = [...Map.groupBy(props.profiles, (profile) => profile.appId)].map(([appId, profiles]) => ({
    key: appId,
    name: known.get(appId)?.name ?? profiles[0]?.appSlug ?? appId,
    image: known.get(appId)?.icon ?? undefined,
  }))
  const missing = props.profiles.filter((profile) => Profiles.gaps(profile).length > 0).length
  return (
    <>
      <Popover.Root>
        <Popover.Trigger
          render={
            <Select.Button
              appearance="plain"
              size="medium"
              label={`Apps: ${items.map((item) => item.name).join(", ")}${missing ? `, ${missing} not connected` : ""}`}
            >
              <Avatar.Group items={items} size="small" />
              {missing ? <Badge tone="warning">{`${missing}`}</Badge> : null}
            </Select.Button>
          }
        />
        <Popover.Content label="Apps this chat can use" padding="small">
          <List.Root label="Apps">
            {props.profiles.map((profile) => {
              const gaps = Profiles.gaps(profile)
              return (
                <List.Item
                  key={profile.id}
                  leading={
                    <Avatar.Root
                      name={known.get(profile.appId)?.name ?? profile.appSlug}
                      image={known.get(profile.appId)?.icon ?? undefined}
                      size="small"
                      decorative
                    />
                  }
                  title={`${known.get(profile.appId)?.name ?? profile.appSlug} · ${profile.name}`}
                  description={gaps.length ? gaps.map((gap) => gap.name).join(", ") : "Connected"}
                  trailing={
                    gaps.length ? (
                      <Button appearance="secondary" size="small" onClick={() => setOpened(profile)}>
                        Connect
                      </Button>
                    ) : null
                  }
                />
              )
            })}
          </List.Root>
        </Popover.Content>
      </Popover.Root>
      {opened ? (
        <ProfileDialog appId={opened.appId} profileId={opened.id} onClose={() => setOpened(undefined)} />
      ) : null}
    </>
  )
}
