import { useState, type ReactNode } from "react"
import type { SettingsInfo, SpaceHand } from "@ren/client"
import { Session } from "@ren/schema/session"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { InstructionsField } from "../../components/instructions-field.js"
import { EditableText } from "../../components/editable-text.js"
import { ModelPicker } from "../../components/model-picker.js"
import { Row, Rows, Section } from "../../components/page.js"
import { Choice } from "../../components/settings-shared.js"
import { useAutosave } from "../../lib/use-autosave.js"
import { errorMessage } from "../../lib/errors.js"
import { useMe } from "../../lib/use-me.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

const modelsProbe = Session.ID.create()

type Space = ReturnType<typeof useSpace>

const ownMachine = "colocated"

const noHand = "none"

const remotePrefix = "remote:"

const valueOf = (hand: SpaceHand) => {
  if (hand.placement === "remote") return `${remotePrefix}${hand.environmentTemplateId}`
  return hand.placement === "colocated" ? (hand.environmentTemplateId ?? ownMachine) : hand.placement
}

const handOf = (value: string): SpaceHand => {
  if (value === noHand) return { placement: "none" }
  if (value.startsWith(remotePrefix))
    return { placement: "remote", environmentTemplateId: value.slice(remotePrefix.length) }
  return { placement: "colocated", environmentTemplateId: value === ownMachine ? null : value }
}

// oxlint-disable-next-line ren/no-comments -- A co-located hand: Ren's standard machine or a template that built, of a provider whose machines run the brain too (EN3). A remote hand: machines of any template that built, which chats share (EN43). None removes the file and shell tools (EN23).
function Hand(props: { space: Space; save: (change: { hand: SpaceHand }) => Promise<unknown> }) {
  const { api } = RouterContext.useRouterContext()
  const templates = useQuery(api["environment-template"].list.queryOptions({ page: 1, pageSize: 50 }))
  const providers = useQuery(api.environmentProvider.list.queryOptions())
  const colocated = new Set((providers.data ?? []).filter((each) => each.canColocate).map((each) => each.id))
  const built = (templates.data?.items ?? []).filter(
    (template) => Boolean(template.image) || template.buildStatus === "ready",
  )
  return (
    <Choice
      label="Tools run on"
      options={[
        { value: ownMachine, label: "Ren’s standard machine" },
        ...built
          .filter((template) => colocated.has(template.provider))
          .map((template) => ({ value: template.id, label: template.name })),
        ...built.map((template) => ({
          value: `${remotePrefix}${template.id}`,
          label: `${template.name}, shared machines`,
        })),
        { value: noHand, label: "No machine" },
      ]}
      value={valueOf(props.space.hand)}
      disabled={!props.space.canUpdate}
      onChange={(value) => void props.save({ hand: handOf(value) })}
    />
  )
}

function useSpaceSettings(spaceId: string) {
  const { api } = RouterContext.useRouterContext()
  const settings = useQuery(api["space-settings"].get.queryOptions({ idOrSlug: spaceId }))
  const update = useMutation(api["space-settings"].update.mutationOptions())
  const current: SettingsInfo = settings.data?.settings ?? {}
  return {
    loading: settings.isPending,
    canUpdate: settings.data?.canUpdate ?? false,
    saving: update.isPending,
    current,
    save: (patch: Partial<SettingsInfo>) =>
      update.mutateAsync(
        { id: spaceId, settings: { ...current, ...patch } },
        { onError: (error) => toast.error("Couldn’t save the settings", { description: errorMessage(error) }) },
      ),
  }
}

function DefaultModel(props: { settings: ReturnType<typeof useSpaceSettings> }) {
  const { api } = RouterContext.useRouterContext()
  const models = useQuery(api.chat.models.queryOptions({ id: modelsProbe }))
  const organization = useQuery(api["organization-settings"].get.queryOptions({ idOrSlug: useMe().organization.id }))
  const listed = (ref: SettingsInfo["model"]) =>
    models.data?.some((each) => each.id === ref?.modelId && each.providerID === ref.endpointId) ? ref : undefined
  const model = listed(props.settings.current.model) ?? listed(organization.data?.settings.model)
  const value = model && {
    id: model.modelId,
    providerID: model.endpointId,
    ...(model.variant && { variant: model.variant }),
  }
  return (
    <ModelPicker
      models={models.data ?? []}
      loading={models.isPending || props.settings.loading}
      value={value ?? models.data?.at(0)}
      disabled={!props.settings.canUpdate}
      onChange={(next) =>
        void props.settings.save({
          model: { endpointId: next.providerID, modelId: next.id, ...(next.variant && { variant: next.variant }) },
        })
      }
    />
  )
}

function Details(props: { space: Space; model: ReactNode }) {
  const { api } = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const update = useMutation(api.space.update.mutationOptions())
  const space = props.space
  const save = (change: { name?: string; description?: string | null; hand?: SpaceHand }) =>
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
        <Row
          key="hand"
          title="Tools run on"
          description="The machine of a chat’s file and shell tools. A change reaches it when it wakes; with no machine, chats have no file or shell tools."
        >
          <Hand space={space} save={save} />
        </Row>,
      ]}
    </Rows>
  )
}

function Instructions(props: { spaceName: string; settings: ReturnType<typeof useSpaceSettings> }) {
  const settings = props.settings
  const [instructions, setInstructions] = useState<string>()
  useAutosave(instructions, settings.current.instructions ?? "", (value) => settings.save({ instructions: value }))
  return (
    <Section title="Instructions" description={`Guidance every agent follows in ${props.spaceName}.`}>
      <InstructionsField
        label="Space instructions"
        value={instructions ?? settings.current.instructions ?? ""}
        readOnly={!settings.canUpdate}
        disabled={settings.loading}
        onChange={setInstructions}
        placeholder={"# Space instructions\n\n- How agents should work in this space."}
      />
      <p className="text-xs text-muted-foreground">{settings.saving ? "Saving…" : "Changes save automatically."}</p>
    </Section>
  )
}

export function SpaceSettingsTab() {
  const space = useSpace()
  const settings = useSpaceSettings(space.id)
  return (
    <div className="flex flex-col gap-10">
      <Details space={space} model={<DefaultModel settings={settings} />} />
      <Instructions spaceName={space.name} settings={settings} />
    </div>
  )
}
