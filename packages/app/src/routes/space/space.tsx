import { useMutation } from "@tanstack/react-query"
import { Outlet, useNavigate } from "@tanstack/react-router"
import { IconCube, IconLock } from "@tabler/icons-react"
import { toast } from "sonner"
import { Page } from "@/components/ren/page"
import { RowMenu } from "@/components/ren/row-menu"
import { api, errorMessage } from "@/lib/api"
import { useSpace } from "@/routes/space/use-space"

function useSpaceLayout() {
  const space = useSpace()
  const navigate = useNavigate()
  const archive = useMutation(api.space.archive.mutationOptions())
  return {
    space,
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
      <Outlet />
    </Page>
  )
}
