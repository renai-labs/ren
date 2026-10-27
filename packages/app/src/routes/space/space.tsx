import { useMutation } from "@tanstack/react-query"
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { IconArrowLeft, IconCube } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tabs } from "@/components/ui/tabs"
import { Page, PageTabsList, PageTabsTrigger } from "@/components/ren/page"
import { RowMenu } from "@/components/ren/row-menu"
import { api, errorMessage } from "@/lib/api"
import { useSpace } from "@/routes/space/use-space"

const tabs = ["overview", "members", "apps", "credentials", "factory"] as const

type Tab = (typeof tabs)[number]

const isTab = (value: string): value is Tab => tabs.some((tab) => tab === value)

const tabPaths = {
  overview: "/spaces/$spaceId",
  members: "/spaces/$spaceId/members",
  apps: "/spaces/$spaceId/apps",
  credentials: "/spaces/$spaceId/credentials",
  factory: "/spaces/$spaceId/factory",
} as const

function useSpaceLayout() {
  const space = useSpace()
  const navigate = useNavigate()
  const path = useLocation({ select: (location) => location.pathname })
  const archive = useMutation(api.space.archive.mutationOptions())
  const last = path.split("/").at(-1) ?? ""
  return {
    space,
    tab: isTab(last) ? last : "overview",
    openTab: (tab: Tab) => void navigate({ to: tabPaths[tab], params: { spaceId: space.id } }),
    archive: () =>
      archive.mutateAsync(
        { id: space.id },
        {
          onSuccess: () => {
            toast.success(`${space.name} archived`)
            void navigate({ to: "/spaces" })
          },
          onError: (error) => toast.error("Could not archive the space", { description: errorMessage(error) }),
        },
      ),
  }
}

const back = (
  <Button
    variant="ghost"
    size="xs"
    className="h-6.5 text-muted-foreground"
    nativeButton={false}
    render={<Link to="/spaces" />}
  >
    <IconArrowLeft className="size-4" />
    Spaces
  </Button>
)

const media = (
  <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary">
    <IconCube className="size-8 text-muted-foreground" />
  </span>
)

export function SpaceLayout() {
  const page = useSpaceLayout()
  const space = page.space
  return (
    <Page
      title={space.name}
      description={space.description ?? undefined}
      back={back}
      media={media}
      menu={
        space.canArchive ? (
          <RowMenu
            label="Space actions"
            items={[
              {
                label: "Archive space",
                onSelect: page.archive,
                confirm: {
                  title: `Archive “${space.name}”?`,
                  description: "Its members lose access. Only the API can bring it back.",
                  action: "Archive",
                },
              },
            ]}
          />
        ) : undefined
      }
    >
      <Tabs value={page.tab} onValueChange={(value: Tab) => page.openTab(value)}>
        <PageTabsList>
          <PageTabsTrigger value="overview">Overview</PageTabsTrigger>
          <PageTabsTrigger value="members" count={space.memberCount}>
            Members
          </PageTabsTrigger>
          <PageTabsTrigger value="apps">Apps</PageTabsTrigger>
          <PageTabsTrigger value="credentials">Keys</PageTabsTrigger>
          <PageTabsTrigger value="factory">Factory</PageTabsTrigger>
        </PageTabsList>
        <div className="pt-4">
          <Outlet />
        </div>
      </Tabs>
    </Page>
  )
}
