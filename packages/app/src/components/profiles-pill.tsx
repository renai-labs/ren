import type { AppProfileInfo } from "@ren/client"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { List } from "@ren/ui/list"
import { Popover } from "@ren/ui/popover"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { ProfileDialog } from "./profile-dialog.js"
import { Profiles } from "./profiles.js"

// oxlint-disable-next-line ren/no-comments -- profiles.md P15: the gaps of the profiles a chat reaches. Each opens its profile.
export function SessionProfilesPill(props: { readonly sessionId: string }) {
  const context = RouterContext.useRouterContext()
  const reach = useQuery({
    ...context.api["app-profile-reach"].session.profiles.queryOptions({ id: props.sessionId }),
    refetchOnWindowFocus: "always",
  })
  return <Pill profiles={reach.data?.profiles ?? []} />
}

// oxlint-disable-next-line ren/no-comments -- The same for a new chat of the caller in a space.
export function SpaceProfilesPill(props: { readonly spaceId: string }) {
  const context = RouterContext.useRouterContext()
  const reach = useQuery({
    ...context.api["app-profile-reach"].space.profiles.queryOptions({ id: props.spaceId }),
    refetchOnWindowFocus: "always",
  })
  return <Pill profiles={reach.data?.profiles ?? []} />
}

function Pill(props: { readonly profiles: ReadonlyArray<AppProfileInfo> }) {
  const [opened, setOpened] = useState<AppProfileInfo>()
  const profiles = props.profiles
  const label = Profiles.gapLabel(profiles)
  if (!label) return null
  return (
    <>
      <Popover.Root>
        <Popover.Trigger
          render={
            <Button appearance="secondary" size="small">
              {label}
            </Button>
          }
        />
        <Popover.Content label="Accounts this chat needs" padding="small">
          <List.Root label="Profiles with gaps">
            {profiles
              .filter((profile) => Profiles.gaps(profile).length > 0)
              .map((profile) => (
                <List.Item
                  key={profile.id}
                  title={`${profile.appSlug} · ${profile.name}`}
                  description={Profiles.gaps(profile)
                    .map((gap) => gap.name)
                    .join(", ")}
                  trailing={
                    <span className="flex items-center gap-2">
                      <Badge tone="neutral">{`${Profiles.gaps(profile).length}`}</Badge>
                      <Button appearance="secondary" size="small" onClick={() => setOpened(profile)}>
                        Connect
                      </Button>
                    </span>
                  }
                />
              ))}
          </List.Root>
        </Popover.Content>
      </Popover.Root>
      {opened ? (
        <ProfileDialog appId={opened.appId} profileId={opened.id} onClose={() => setOpened(undefined)} />
      ) : null}
    </>
  )
}
