import { useMutation } from "@tanstack/react-query"
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { IconArrowLeft, IconCube, IconLock } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tabs } from "@/components/ui/tabs"
import { Page, PageTabsList, PageTabsTrigger } from "@/components/ren/page"
import { RowMenu } from "@/components/ren/row-menu"
import { api, errorMessage } from "@/lib/api"
import { spaceSectionOf, spaceSections, type SpaceSection } from "@/components/ren/space-sidebar"
import { useSpace } from "@/routes/space/use-space"
import { useSpaceNav } from "@/stores/ui"

function useSpaceLayout() {
  const space = useSpace()
  const navigate = useNavigate()
  const path = useLocation({ select: (location) => location.pathname })
  const archive = useMutation(api.space.archive.mutationOptions())
  return {
    space,
    tab: spaceSectionOf(path),
    inSidebar: useSpaceNav() === "sidebar",
    openTab: (tab: SpaceSection) => {
      const section = spaceSections.find((each) => each.value === tab)
      if (section) void navigate({ to: section.to, params: { spaceId: space.id } })
    },
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
    size="sm"
    className="text-muted-foreground"
    nativeButton={false}
    render={<Link to="/spaces" />}
  >
    <IconArrowLeft className="size-4" />
    Spaces
  </Button>
)

const media = (kind: string) => (
  <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary">
    {kind === "private" ? (
      <IconLock className="size-8 text-muted-foreground" />
    ) : (
      <IconCube className="size-8 text-muted-foreground" />
    )}
  </span>
)

export function SpaceLayout() {
  const page = useSpaceLayout()
  const space = page.space
  return (
    <Page
      title={space.name}
      description={space.description ?? undefined}
      back={page.inSidebar ? undefined : back}
      media={media(space.kind)}
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
      {page.inSidebar ? (
        <Outlet />
      ) : (
        <Tabs value={page.tab} onValueChange={(value: SpaceSection) => page.openTab(value)}>
          <PageTabsList>
            {spaceSections.map((section) => (
              <PageTabsTrigger
                key={section.value}
                value={section.value}
                count={section.value === "members" ? space.memberCount : undefined}
              >
                {section.label}
              </PageTabsTrigger>
            ))}
          </PageTabsList>
          <div className="pt-4">
            <Outlet />
          </div>
        </Tabs>
      )}
    </Page>
  )
}
