import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { EditableText } from "../../components/editable-text.js"
import { Row, Rows } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { FactoryDashboard } from "./factory-view.js"
import { isSoftwareFactory } from "../../lib/factory.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

export function SpaceOverviewTab() {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const queryClient = useQueryClient()
  const update = useMutation(api.space.update.mutationOptions())
  const save = (change: { name?: string; description?: string | null }) =>
    update.mutateAsync(
      { id: space.id, ...change },
      {
        onSuccess: (updated) =>
          queryClient.setQueryData(api.space.get.queryOptions({ idOrSlug: space.id }).queryKey, updated),
        onError: (error) => toast.error("Could not save the space", { description: errorMessage(error) }),
      },
    )
  if (isSoftwareFactory(space)) return <FactoryDashboard space={space} />
  return (
    <Rows>
      {[
        <Row key="name" title="Name">
          <EditableText
            value={space.name}
            label="space name"
            required
            readOnly={!space.canUpdate}
            onCommit={(name) => save({ name })}
          />
        </Row>,
        <Row key="description" title="Description">
          <EditableText
            value={space.description ?? ""}
            placeholder="No description"
            label="space description"
            readOnly={!space.canUpdate}
            onCommit={(description) => save({ description: description || null })}
          />
        </Row>,
      ]}
    </Rows>
  )
}
