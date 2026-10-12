import { Avatar } from "@ren/ui/avatar"
import type { SpaceInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Menu } from "@ren/ui/menu"
import { PageShell } from "@ren/ui/page-shell"
import { SearchField } from "@ren/ui/search-field"
import { StateMessage } from "@ren/ui/state-message"
import { Text } from "@ren/ui/text"
import { Toolbar } from "@ren/ui/toolbar"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useDeferredValue, useState } from "react"
import { Auth } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"
import { CreateSpaceDialog } from "./create-space-dialog.js"
import { JoinSpaceDialog } from "./join-space-dialog.js"
import { Spaces } from "./spaces.js"

export function SpacesPage(props: { userId: string }) {
  const context = RouterContext.useRouterContext()
  const spaces = useQuery(context.api.space.list.queryOptions({ page: 1, pageSize: 100 }))
  const [query, setQuery] = useState("")
  const needle = useDeferredValue(query).trim()
  const visible = (spaces.data?.items ?? []).filter((space) =>
    Spaces.matches([space.name, space.description ?? ""], needle),
  )
  return (
    <PageShell.Root
      title="Spaces"
      subtitle="Groups of people in your organization."
      toolbar={
        <Toolbar.Root>
          <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search spaces" />
          <CreateActions spaces={spaces.data?.items ?? []} userId={props.userId} />
        </Toolbar.Root>
      }
    >
      <section aria-label="Spaces" aria-live="polite">
        {visible.length === 0 ? (
          <StateMessage
            state={needle ? "no-results" : "empty"}
            icon={<Icon glyph="Cube" size="medium" tone="secondary" />}
            title={needle ? "No matching spaces" : "No spaces yet"}
            description={needle ? "Try a different search." : "Create one to bring people together."}
          />
        ) : null}
        {visible.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {visible.map((space, index) => (
              <Card.Root
                key={space.id}
                interaction="link"
                density="spacious"
                render={<Link to="/sessions/spaces/$spaceId" params={{ spaceId: space.id }} />}
                label={`Open ${space.name}`}
                appearanceOrder={index}
                media={<Avatar.Root name={space.name} glyph="Cube" size="extra-large" shape="square" decorative />}
                title={space.name}
                description={space.description?.trim() || "No description"}
                footer={
                  <Text purpose="caption" numerals="tabular" element="span">
                    <span className="flex items-center gap-2">
                      <Icon glyph="Users" />
                      {space.memberCount} {space.memberCount === 1 ? "member" : "members"}
                    </span>
                  </Text>
                }
              />
            ))}
          </div>
        ) : null}
      </section>
    </PageShell.Root>
  )
}

function CreateActions(props: { spaces: ReadonlyArray<SpaceInfo>; userId: string }) {
  const context = RouterContext.useRouterContext()
  const role = useQuery(Auth.activeRoleOptions(context.auth))
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  if (!role.data) return null
  return (
    <>
      {Auth.isAdminRole(role.data) ? (
        <Menu.Root>
          <Menu.Trigger
            render={
              <IconButton appearance="primary" size="small" label="Create or join a space">
                <Icon glyph="Plus" />
              </IconButton>
            }
          />
          <Menu.Popup alignment="end" width="small">
            <Menu.Item icon={<Icon glyph="Plus" />} onSelect={() => setCreating(true)}>
              Create space
            </Menu.Item>
            <Menu.Item icon={<Icon glyph="LogIn" />} onSelect={() => setJoining(true)}>
              Join space
            </Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      ) : (
        <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />} onClick={() => setCreating(true)}>
          New space
        </Button>
      )}
      {creating ? <CreateSpaceDialog onClose={() => setCreating(false)} /> : null}
      {joining ? (
        <JoinSpaceDialog spaces={props.spaces} userId={props.userId} onClose={() => setJoining(false)} />
      ) : null}
    </>
  )
}
