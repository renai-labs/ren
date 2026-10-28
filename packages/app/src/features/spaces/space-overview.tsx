import { Field, FieldTitle } from "@ren/ui/field"
import { InlineEdit } from "@ren/ui/inline-edit"
import { PageShell } from "@ren/ui/page-shell"
import { Text } from "@ren/ui/text"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Forms } from "../../lib/forms.js"
import { RouterContext } from "../../lib/router-context.js"

export function SpaceOverview(props: { spaceId: string }) {
  const context = RouterContext.useRouterContext()
  const space = useQuery(context.api.space.get.queryOptions({ idOrSlug: props.spaceId }))
  const update = useMutation(context.api.space.update.mutationOptions())
  if (!space.data) return null
  const save = async (change: { name?: string; description?: string | null }) => {
    await update.mutateAsync({ id: props.spaceId, ...change })
  }
  return (
    <PageShell.Section frame="divided">
      <Field orientation="horizontal">
        <FieldTitle>Name</FieldTitle>
        {space.data.canUpdate ? (
          <InlineEdit
            label="Space name"
            alignment="end"
            placeholder="Enter space name"
            required
            schema={Forms.spaceName}
            value={space.data.name}
            onCommit={(name) => save({ name })}
          />
        ) : (
          <Text element="span">{space.data.name}</Text>
        )}
      </Field>
      <Field orientation="horizontal">
        <FieldTitle>Description</FieldTitle>
        {space.data.canUpdate ? (
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
      </Field>
    </PageShell.Section>
  )
}
