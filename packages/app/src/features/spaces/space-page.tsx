import { Suspense } from "react"
import { SpaceSectionSkeleton, spaceSections } from "../../components/route-skeleton.js"
import { useMutation } from "@tanstack/react-query"
import { Outlet, useNavigate } from "@tanstack/react-router"
import { IconArchive } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Page } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { isSoftwareFactory } from "../../lib/factory.js"
import { errorMessage } from "../../lib/errors.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"
import { Routing } from "../../lib/routing.js"

export function SpaceLayout() {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const navigate = useNavigate()
  const archive = useMutation(api.space.archive.mutationOptions())
  const path = Routing.useRenderedPath().split("/")
  const tab = path.at(3) ?? "overview"
  const factory = (tab === "overview" || tab === "kanban") && isSoftwareFactory(space)
  const section = spaceSections[tab] ?? spaceSections.overview
  if ((tab === "webhooks" && path.at(4)) || tab === "artifacts")
    return (
      <Suspense fallback={<SpaceSectionSkeleton />}>
        <Outlet />
      </Suspense>
    )
  if (factory)
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col px-8 pt-2">
        <Suspense fallback={<SpaceSectionSkeleton />}>
          <Outlet />
        </Suspense>
      </div>
    )
  return (
    <Page
      title={section.title}
      description={section.description(space.name)}
      menu={
        space.canArchive ? (
          <RowMenu
            label="Space actions"
            items={[
              {
                label: "Archive space",
                icon: IconArchive,
                onSelect: () =>
                  archive.mutateAsync(
                    { id: space.id },
                    {
                      onSuccess: () => {
                        toast.success(`${space.name} archived`)
                        void navigate({ to: "/spaces" })
                      },
                      onError: (error) =>
                        toast.error("Could not archive the space", { description: errorMessage(error) }),
                    },
                  ),
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
      <Suspense fallback={<SpaceSectionSkeleton />}>
        <Outlet />
      </Suspense>
    </Page>
  )
}
