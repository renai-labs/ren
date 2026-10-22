import type { Brain } from "@ren/schema/brain"
import { Field } from "@ren/ui/field"
import { InlineEdit } from "@ren/ui/inline-edit"
import { PageShell } from "@ren/ui/page-shell"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Forms } from "../../lib/forms.js"
import { RouterContext } from "../../lib/router-context.js"

const scopes = [
  { value: "space", label: "In one shared brain" },
  { value: "session", label: "Each in its own brain" },
] as const satisfies ReadonlyArray<{ readonly value: Brain.Scope; readonly label: string }>

export function SpaceOverview(props: { spaceId: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const options = context.api.space.get.queryOptions({ idOrSlug: props.spaceId })
  const space = useQuery(options)
  const update = useMutation(context.api.space.update.mutationOptions())
  if (!space.data) return null
  const save = async (change: { name?: string; description?: string | null; brainScope?: Brain.Scope }) => {
    queryClient.setQueryData(options.queryKey, await update.mutateAsync({ id: props.spaceId, ...change }))
    await queryClient.invalidateQueries({ queryKey: context.api.space.list.queryKey() })
  }
  return (
    <PageShell.Section frame="divided">
      <Field.Root label="Name" orientation="row">
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
      </Field.Root>
      <Field.Root label="Description" orientation="row">
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
      </Field.Root>
      <Field.Root label="Chats run" orientation="row" description="Applies to new chats. Existing chats keep their brain.">
        {space.data.canUpdate ? (
          <Select.Root<Brain.Scope>
            label="Chats run"
            options={scopes}
            value={space.data.brainScope}
            onValueChange={(brainScope) => void save({ brainScope })}
          />
        ) : (
          <Text element="span">{scopes.find((scope) => scope.value === space.data.brainScope)?.label}</Text>
        )}
      </Field.Root>
    </PageShell.Section>
  )
}
