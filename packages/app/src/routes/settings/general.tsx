import { useState } from "react"
import { Session } from "@ren/schema/session"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Textarea } from "@/components/ui/textarea"
import { EditableText } from "@/components/ren/editable-text"
import { ModelPicker } from "@/components/ren/model-picker"
import { Page, Row, Rows, Section } from "@/components/ren/page"
import { PersonAvatar } from "@/components/ren/person-avatar"
import { useMe } from "@/hooks/use-me"
import { useAutosave } from "@/hooks/use-autosave"
import { api, errorMessage } from "@/lib/api"
import { auth, organizationOptions } from "@/lib/auth"

const modelsProbe = Session.ID.create()

function useGeneralPage() {
  const me = useMe()
  const queryClient = useQueryClient()
  const models = useSuspenseQuery(api.chat.models.queryOptions({ id: modelsProbe })).data
  const settings = useSuspenseQuery(api["organization-settings"].get.queryOptions({ idOrSlug: me.organization.id }))
  const update = useMutation(api["organization-settings"].update.mutationOptions())
  const current = settings.data.settings
  const [instructions, setInstructions] = useState<string>()
  const draft = instructions ?? current.instructions ?? ""
  const saveSettings = (patch: { instructions?: string; model?: { endpointId: string; modelId: string; variant?: string } }) =>
    update.mutateAsync(
      { id: me.organization.id, settings: { ...current, ...patch } },
      { onError: (error) => toast.error("Couldn’t save the settings", { description: errorMessage(error) }) },
    )
  useAutosave(instructions, current.instructions ?? "", (value) => saveSettings({ instructions: value }))
  const model = current.model
  return {
    organization: me.organization,
    canUpdate: settings.data.canUpdate,
    models,
    model: model ? { id: model.modelId, providerID: model.endpointId, ...(model.variant && { variant: model.variant }) } : undefined,
    instructions: draft,
    saving: update.isPending,
    setInstructions,
    chooseModel: (next: { id: string; providerID: string; variant?: string }) =>
      void saveSettings({
        model: { endpointId: next.providerID, modelId: next.id, ...(next.variant && { variant: next.variant }) },
      }),
    rename: async (name: string) => {
      const result = await auth.organization.update({ organizationId: me.organization.id, data: { name } })
      if (result.error !== null) {
        toast.error(result.error.message ?? "Failed to update organization")
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: api.me.get.queryKey() }),
        queryClient.invalidateQueries({ queryKey: organizationOptions(me.organization.id).queryKey }),
      ])
    },
  }
}

export function GeneralSettingsPage() {
  const page = useGeneralPage()
  return (
    <Page title="General">
      <Rows>
        {[
          <Row key="name" title="Name">
            <span className="flex items-center gap-3">
              <PersonAvatar name={page.organization.name} />
              <EditableText
                value={page.organization.name}
                label="name"
                required
                readOnly={!page.canUpdate}
                onCommit={page.rename}
              />
            </span>
          </Row>,
          <Row
            key="model"
            title="Default model"
            description="New chats start with it unless a space sets its own."
          >
            <ModelPicker
              models={page.models}
              value={page.model ?? page.models.at(0)}
              disabled={!page.canUpdate}
              onChange={page.chooseModel}
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
          value={page.instructions}
          readOnly={!page.canUpdate}
          onChange={(event) => page.setInstructions(event.currentTarget.value)}
          placeholder={"# Organization instructions\n\n- Conventions every agent should follow."}
          className="min-h-110 rounded-xl bg-card p-4 dark:bg-card"
        />
        <p className="text-xs text-muted-foreground">
          {page.saving ? "Saving…" : "Changes save automatically."}
        </p>
      </Section>
    </Page>
  )
}
