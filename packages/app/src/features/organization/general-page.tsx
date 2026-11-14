import type { SettingsInfo } from "@ren/client"
import { Session } from "@ren/schema/session"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { InstructionsField } from "../../components/instructions-field.js"
import { EditableText } from "../../components/editable-text.js"
import { ModelPicker, modelRef, modelSetting, pickModel } from "../../components/model-picker.js"
import { Page, Row, Rows, Section } from "../../components/page.js"
import { AvatarPicker } from "../../components/avatar-picker.js"
import { useMe } from "../../lib/use-me.js"
import { errorMessage } from "../../lib/errors.js"
import { organizationOptions } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"

const modelsProbe = Session.ID.create()

export function GeneralSettingsPage() {
  const { api, auth } = RouterContext.useRouterContext()
  const me = useMe()
  const queryClient = useQueryClient()
  const models = useSuspenseQuery(api.chat.models.queryOptions({ id: modelsProbe })).data.models
  const settings = useSuspenseQuery(api["organization-settings"].get.queryOptions({ idOrSlug: me.organization.id }))
  const update = useMutation(api["organization-settings"].update.mutationOptions())
  const current = settings.data.settings
  const saveSettings = (patch: Partial<SettingsInfo>) =>
    update.mutateAsync(
      { id: me.organization.id, settings: { ...current, ...patch } },
      { onError: (error) => toast.error("Couldn’t save the settings", { description: errorMessage(error) }) },
    )
  const organization = me.organization
  const canUpdate = settings.data.canUpdate
  const rename = async (name: string) => {
    const result = await auth.organization.update({ organizationId: me.organization.id, data: { name } })
    if (result.error !== null) {
      toast.error(result.error.message ?? "Failed to update organization")
      return
    }
    await Promise.all([
      // ast-grep-ignore: no-manual-invalidation -- the organization name changes through Better Auth
      queryClient.invalidateQueries({ queryKey: api.me.get.queryKey() }),
      // ast-grep-ignore: no-manual-invalidation -- the organization name changes through Better Auth
      queryClient.invalidateQueries({ queryKey: organizationOptions(auth, me.organization.id).queryKey }),
    ])
  }
  const changeLogo = async (logo: string | null) => {
    const result = await auth.organization.update({ organizationId: me.organization.id, data: { logo: logo ?? "" } })
    if (result.error !== null) {
      toast.error(result.error.message ?? "Failed to update the logo")
      return
    }
    await Promise.all([
      // ast-grep-ignore: no-manual-invalidation -- the organization logo changes through Better Auth
      queryClient.invalidateQueries({ queryKey: api.me.get.queryKey() }),
      // ast-grep-ignore: no-manual-invalidation -- the organization logo changes through Better Auth
      queryClient.invalidateQueries({ queryKey: organizationOptions(auth, me.organization.id).queryKey }),
    ])
  }
  return (
    <Page title="General">
      <Rows>
        {[
          <Row key="logo" title="Logo" description="Shown in the sidebar and wherever your organization appears.">
            <AvatarPicker
              kind="organization"
              label="Organization logo"
              name={organization.name}
              value={organization.logo}
              disabled={!canUpdate}
              onChange={changeLogo}
            />
          </Row>,
          <Row key="name" title="Name">
            <EditableText value={organization.name} label="name" required readOnly={!canUpdate} onCommit={rename} />
          </Row>,
          <Row key="model" title="Default model" description="New chats start with it unless a space sets its own.">
            <ModelPicker
              models={models}
              value={pickModel(models, [current.model && modelRef(current.model)])}
              disabled={!canUpdate}
              onChange={(next) => void saveSettings({ model: modelSetting(next) })}
            />
          </Row>,
        ]}
      </Rows>
      <Section
        title="Instructions"
        description="Shared guidance for every agent in your organization. Spaces can add their own."
      >
        <InstructionsField
          label="Instructions"
          value={current.instructions ?? ""}
          readOnly={!canUpdate}
          saving={update.isPending}
          onSave={(instructions) => saveSettings({ instructions })}
          placeholder={"# Organization instructions\n\n- Conventions every agent should follow."}
        />
      </Section>
    </Page>
  )
}
