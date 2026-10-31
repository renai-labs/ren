import { useMutation } from "@tanstack/react-query"
import { Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { Page } from "@/components/ren/page"
import { RowMenu } from "@/components/ren/row-menu"
import { isSoftwareFactory } from "@/factory/lib/real"
import { api, errorMessage } from "@/lib/api"
import { useSpace } from "@/routes/space/use-space"

const sections: Readonly<Record<string, { title: string; description: (space: string) => string }>> = {
  overview: { title: "Overview", description: (space) => `The name and description of ${space}.` },
  members: { title: "Members", description: (space) => `People who can use ${space}.` },
  apps: { title: "Apps", description: (space) => `Apps every chat in ${space} can use.` },
  repositories: {
    title: "Repositories",
    description: (space) => `Repositories Ren can read in ${space}. To change code, ask Ren to clone one.`,
  },
  channels: {
    title: "Mentions",
    description: (space) => `Channels where people can mention @Ren to work in ${space}.`,
  },
  credentials: { title: "Keys", description: (space) => `Keys every chat in ${space} can use.` },
  schedules: { title: "Scheduled", description: (space) => `Work that starts in ${space} on a schedule.` },
  factory: { title: "Factory", description: (space) => `Agents that work on tasks in ${space}.` },
}

function useSpaceLayout() {
  const space = useSpace()
  const navigate = useNavigate()
  const archive = useMutation(api.space.archive.mutationOptions())
  const tab = useLocation({ select: (location) => location.pathname.split("/").at(3) ?? "overview" })
  const factory = (tab === "overview" || tab === "kanban") && isSoftwareFactory(space)
  return {
    space,
    factory,
    section: sections[tab] ?? sections.overview,
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

export function SpaceLayout() {
  const page = useSpaceLayout()
  const space = page.space
  if (page.factory)
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col px-8 pt-2">
        <Outlet />
      </div>
    )
  return (
    <Page
      title={page.section?.title ?? space.name}
      description={page.section?.description(space.name)}
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
      <Outlet />
    </Page>
  )
}
