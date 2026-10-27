import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { EditableText } from "@/components/ren/editable-text"
import { Row, Rows } from "@/components/ren/page"
import { api, errorMessage } from "@/lib/api"
import { useSpace } from "@/routes/space/use-space"

function useSpaceOverview() {
  const space = useSpace()
  const queryClient = useQueryClient()
  const update = useMutation(api.space.update.mutationOptions())
  return {
    space,
    save: (change: { name?: string; description?: string | null }) =>
      update.mutateAsync(
        { id: space.id, ...change },
        {
          onSuccess: (updated) =>
            queryClient.setQueryData(api.space.get.queryOptions({ idOrSlug: space.id }).queryKey, updated),
          onError: (error) => toast.error("Could not save the space", { description: errorMessage(error) }),
        },
      ),
  }
}

export function SpaceOverviewTab() {
  const page = useSpaceOverview()
  return (
    <Rows>
      {[
        <Row key="name" title="Name">
          <EditableText
            value={page.space.name}
            label="space name"
            required
            readOnly={!page.space.canUpdate}
            onCommit={(name) => page.save({ name })}
          />
        </Row>,
        <Row key="description" title="Description">
          <EditableText
            value={page.space.description ?? ""}
            placeholder="No description"
            label="space description"
            readOnly={!page.space.canUpdate}
            onCommit={(description) => page.save({ description: description || null })}
          />
        </Row>,
      ]}
    </Rows>
  )
}
