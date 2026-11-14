import type { ReactNode } from "react"
import { Session } from "@ren/schema/session"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { EditableText } from "../../components/editable-text.js"
import { ModelPicker, modelRef, modelSetting, pickModel } from "../../components/model-picker.js"
import { Row, Rows } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { useMe } from "../../lib/use-me.js"
import { useSpace, useSpaceSettings } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

const modelsProbe = Session.ID.create()

type Space = ReturnType<typeof useSpace>

function DefaultModel(props: { settings: ReturnType<typeof useSpaceSettings> }) {
  const { api } = RouterContext.useRouterContext()
  const models = useQuery(api.chat.models.queryOptions({ id: modelsProbe }))
  const organization = useQuery(api["organization-settings"].get.queryOptions({ idOrSlug: useMe().organization.id }))
  return (
    <ModelPicker
      models={models.data ?? []}
      loading={models.isPending || props.settings.loading}
      value={pickModel(
        models.data ?? [],
        [props.settings.current.model, organization.data?.settings.model].map((model) => model && modelRef(model)),
      )}
      disabled={!props.settings.canUpdate}
      onChange={(next) => void props.settings.save({ model: modelSetting(next) })}
    />
  )
}

function Details(props: { space: Space; model: ReactNode }) {
  const { api } = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const update = useMutation(api.space.update.mutationOptions())
  const space = props.space
  const save = (change: { name?: string; description?: string | null }) =>
    update.mutateAsync(
      { id: space.id, ...change },
      {
        onSuccess: (updated) =>
          queryClient.setQueryData(api.space.get.queryOptions({ idOrSlug: space.id }).queryKey, updated),
        onError: (error) => toast.error("Could not save the space", { description: errorMessage(error) }),
      },
    )
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
            multiline
            readOnly={!space.canUpdate}
            onCommit={(description) => save({ description: description || null })}
          />
        </Row>,
        <Row key="model" title="Default model" description="New chats in this space start with it.">
          {props.model}
        </Row>,
      ]}
    </Rows>
  )
}

export function SpaceSettingsTab() {
  const space = useSpace()
  const settings = useSpaceSettings(space.id)
  return <Details space={space} model={<DefaultModel settings={settings} />} />
}
