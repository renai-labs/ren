import { Field } from "@ren/ui/field"
import { InlineEdit } from "@ren/ui/inline-edit"
import { PageShell } from "@ren/ui/page-shell"
import { Text } from "@ren/ui/text"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"
import { Spaces } from "./spaces.js"

export function SpaceOverview(props: { spaceId: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const options = context.api.space.get.queryOptions({ idOrSlug: props.spaceId })
  const space = useQuery(options)
  const update = useMutation(context.api.space.update.mutationOptions())
  if (!space.data) return null
  const save = async (change: { name?: string; description?: string | null }) => {
    queryClient.setQueryData(options.queryKey, await update.mutateAsync({ id: props.spaceId, ...change }))
    await queryClient.invalidateQueries({ queryKey: context.api.space.list.queryKey() })
  }
  return (
    <PageShell.Section frame="divided">
      <Field.Root label="Name" orientation="row">
        {space.data.canManage ? (
          <InlineEdit
            label="Space name"
            alignment="end"
            placeholder="Enter space name"
            required
            validate={Spaces.nameProblem}
            value={space.data.name}
            onCommit={(name) => save({ name })}
          />
        ) : (
          <Text element="span">{space.data.name}</Text>
        )}
      </Field.Root>
      <Field.Root label="Description" orientation="row">
        {space.data.canManage ? (
          <InlineEdit
            label="Space description"
            alignment="end"
            placeholder="What does this space work on?"
            value={space.data.description ?? ""}
            onCommit={(description) => save({ description: description || null })}
          />
        ) : (
          <Text element="span">{space.data.description ?? "—"}</Text>
        )}
      </Field.Root>
    </PageShell.Section>
  )
}
