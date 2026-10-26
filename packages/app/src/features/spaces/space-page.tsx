import type { SpaceInfo } from "@ren/client"
import { Avatar } from "@ren/ui/avatar"
import { Breadcrumbs } from "@ren/ui/breadcrumbs"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Menu } from "@ren/ui/menu"
import { PageShell } from "@ren/ui/page-shell"
import { Tabs } from "@ren/ui/tabs"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import type { ReactNode } from "react"
import { RouterContext } from "../../lib/router-context.js"

export function SpacePage(props: { spaceId: string; children: ReactNode }) {
  const context = RouterContext.useRouterContext()
  const space = useQuery(context.api.space.get.queryOptions({ idOrSlug: props.spaceId }))
  if (!space.data) return null
  const params = { spaceId: props.spaceId }
  return (
    <PageShell.Root
      layout="detail"
      heading="entity"
      context={
        <Breadcrumbs.Root>
          <Breadcrumbs.Link render={<Link to="/spaces" />}>Spaces</Breadcrumbs.Link>
          <Breadcrumbs.Page>{space.data.name}</Breadcrumbs.Page>
        </Breadcrumbs.Root>
      }
      media={<Avatar.Root name={space.data.name} glyph="Cube" size="extra-large" shape="square" decorative />}
      title={space.data.name}
      subtitle={space.data.description ?? undefined}
      actions={space.data.canArchive ? <SpaceMenu space={space.data} /> : undefined}
      navigation={
        <Tabs.Navigation label={space.data.name}>
          <Tabs.Link render={<Link to="/spaces/$spaceId" params={params} activeOptions={{ exact: true }} />}>
            Overview
          </Tabs.Link>
          <Tabs.Link render={<Link to="/spaces/$spaceId/members" params={params} />} count={space.data.memberCount}>
            Members
          </Tabs.Link>
          <Tabs.Link render={<Link to="/spaces/$spaceId/credentials" params={params} />}>Credentials</Tabs.Link>
          <Tabs.Link render={<Link to="/spaces/$spaceId/factory" params={params} />}>Factory</Tabs.Link>
        </Tabs.Navigation>
      }
    >
      {props.children}
    </PageShell.Root>
  )
}

function SpaceMenu(props: { space: SpaceInfo }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const archive = useMutation(context.api.space.archive.mutationOptions())
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton label="Space actions">
              <Icon glyph="MoreHorizontal" />
            </IconButton>
          }
        />
        <Menu.Popup alignment="end">
          <Menu.Item tone="danger" icon={<Icon glyph="Archive" />} onSelect={() => setConfirming(true)}>
            Archive space
          </Menu.Item>
        </Menu.Popup>
      </Menu.Root>
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Archive “${props.space.name}”?`}
        description="Its members lose access. Only the API can bring it back."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={async () => {
          await archive.mutateAsync({ id: props.space.id })
          await queryClient.invalidateQueries({ queryKey: context.api.space.list.queryKey() })
        }}
        onConfirmed={() => {
          Toast.manager.add({ type: "success", title: `${props.space.name} archived` })
          void navigate({ to: "/spaces" })
        }}
      />
    </>
  )
}
