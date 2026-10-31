import { useState } from "react"
import { Session } from "@ren/schema/session"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { Textarea } from "@ren/ui/textarea"
import { EditableText } from "../../components/editable-text.js"
import { ModelPicker } from "../../components/model-picker.js"
import { Page, Row, Rows, Section } from "../../components/page.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { useMe } from "../../lib/use-me.js"
import { useAutosave } from "../../lib/use-autosave.js"
import { errorMessage } from "../../lib/errors.js"
import { organizationOptions } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"

const modelsProbe = Session.ID.create()

export function GeneralSettingsPage() {
  const { api, auth } = RouterContext.useRouterContext()
  const me = useMe()
  const queryClient = useQueryClient()
  const models = useSuspenseQuery(api.chat.models.queryOptions({ id: modelsProbe })).data
  const settings = useSuspenseQuery(api["organization-settings"].get.queryOptions({ idOrSlug: me.organization.id }))
  const update = useMutation(api["organization-settings"].update.mutationOptions())
  const current = settings.data.settings
  const [instructions, setInstructions] = useState<string>()
  const draft = instructions ?? current.instructions ?? ""
  const saveSettings = (patch: {
    instructions?: string
    model?: { endpointId: string; modelId: string; variant?: string }
  }) =>
    update.mutateAsync(
      { id: me.organization.id, settings: { ...current, ...patch } },
      { onError: (error) => toast.error("Couldn’t save the settings", { description: errorMessage(error) }) },
    )
  useAutosave(instructions, current.instructions ?? "", (value) => saveSettings({ instructions: value }))
  const model = current.model
  const organization = me.organization
  const canUpdate = settings.data.canUpdate
  const saving = update.isPending
  const chooseModel = (next: { id: string; providerID: string; variant?: string }) =>
    void saveSettings({
      model: { endpointId: next.providerID, modelId: next.id, ...(next.variant && { variant: next.variant }) },
    })
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
  return (
    <Page title="General">
      <Rows>
        {[
          <Row key="name" title="Name">
            <span className="flex items-center gap-3">
              <PersonAvatar name={organization.name} />
              <EditableText value={organization.name} label="name" required readOnly={!canUpdate} onCommit={rename} />
            </span>
          </Row>,
          <Row key="model" title="Default model" description="New chats start with it unless a space sets its own.">
            <ModelPicker
              models={models}
              value={
                (model
                  ? {
                      id: model.modelId,
                      providerID: model.endpointId,
                      ...(model.variant && { variant: model.variant }),
                    }
                  : undefined) ?? models.at(0)
              }
              disabled={!canUpdate}
              onChange={chooseModel}
            />
          </Row>,
        ]}
      </Rows>
      <Section
        title="Instructions"
        description="Shared guidance for every agent in your organization. Spaces can add their own."
      >
        <Textarea
          aria-label="Instructions"
          value={draft}
          readOnly={!canUpdate}
          onChange={(event) => setInstructions(event.currentTarget.value)}
          placeholder={"# Organization instructions\n\n- Conventions every agent should follow."}
          className="min-h-110 rounded-xl bg-card p-4 dark:bg-card"
        />
        <p className="text-xs text-muted-foreground">{saving ? "Saving…" : "Changes save automatically."}</p>
      </Section>
    </Page>
  )
}
