import type { EnvironmentTemplateInfo, SpaceBrainMachine, SpaceHand, SpaceInfo } from "@ren/client"
import { toast } from "@ren/ui/sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Row, Rows, Section } from "../../components/page.js"
import { Choice } from "../../components/settings-shared.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { EnvironmentForm } from "./environment-form.js"

type Save = (change: { brain?: SpaceBrainMachine; hand?: SpaceHand }) => Promise<unknown>

const brainsMachine = "colocated"

const noTools = "none"

const standardMachine = "standard"

const handValue = (hand: SpaceHand) => (hand.placement === "remote" ? hand.environmentTemplateId : hand.placement)

const handOf = (value: string): SpaceHand => {
  if (value === noTools) return { placement: "none" }
  if (value === brainsMachine) return { placement: "colocated" }
  return { placement: "remote", environmentTemplateId: value }
}

const numberIn = (config: EnvironmentTemplateInfo["config"], key: string) => {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return
  const value = config[key]
  return typeof value === "number" ? value : undefined
}

// oxlint-disable-next-line ren/no-comments -- One line per machine: its size when its provider sets one, and its network.
const summaryOf = (machine: EnvironmentTemplateInfo | undefined) => {
  if (!machine) return "Ren’s standard size, any host."
  const cpus = numberIn(machine.config, "cpuCount")
  const memory = numberIn(machine.config, "memoryMiB")
  return [
    ...(cpus ? [`${cpus} vCPU`] : []),
    ...(memory ? [`${memory / 1024} GB`] : []),
    machine.networking.type === "limited" ? "only listed hosts" : "any host",
  ].join(" · ")
}

const useMachines = () => {
  const { api } = RouterContext.useRouterContext()
  const machines = useQuery(api["environment-template"].list.queryOptions(EnvironmentForm.listInput))
  return (machines.data?.items ?? []).filter((each) => Boolean(each.image) || each.buildStatus === "ready")
}

function BrainSection(props: { space: SpaceInfo; save: Save }) {
  const { api } = RouterContext.useRouterContext()
  const providers = useQuery(api.environmentProvider.brains.queryOptions())
  const brain = props.space.brain
  const machines = useMachines().filter((each) => each.provider === brain.provider)
  return (
    <Section title="Brain" description="Where the agent runs.">
      <Rows>
        {[
          <Row key="provider" title="Provider">
            <Choice
              label="Brain provider"
              options={(providers.data ?? []).map((each) => ({ value: each.id, label: each.title }))}
              value={brain.provider ?? ""}
              disabled={!props.space.canUpdate}
              onChange={(provider) => void props.save({ brain: { provider, environmentTemplateId: null } })}
            />
          </Row>,
          <Row
            key="machine"
            title="Machine"
            description={summaryOf(machines.find((each) => each.id === brain.environmentTemplateId))}
          >
            <Choice
              label="Brain machine"
              options={[
                { value: standardMachine, label: "Ren’s standard machine" },
                ...machines.map((each) => ({ value: each.id, label: each.name })),
              ]}
              value={brain.environmentTemplateId ?? standardMachine}
              disabled={!props.space.canUpdate}
              onChange={(value) =>
                void props.save({
                  brain: { provider: brain.provider, environmentTemplateId: value === standardMachine ? null : value },
                })
              }
            />
          </Row>,
        ]}
      </Rows>
    </Section>
  )
}

function HandSection(props: { space: SpaceInfo; save: Save }) {
  const { api } = RouterContext.useRouterContext()
  const brainProviders = useQuery(api.environmentProvider.brains.queryOptions())
  const machines = useMachines()
  const hand = props.space.hand
  const canColocate = (brainProviders.data ?? []).some(
    (each) => each.id === props.space.brain.provider && each.canColocate,
  )
  return (
    <Section title="Hand" description="Where file and shell commands run.">
      <Rows>
        {[
          <Row
            key="hand"
            title="Machine"
            description={
              hand.placement === "remote"
                ? summaryOf(machines.find((each) => each.id === hand.environmentTemplateId))
                : undefined
            }
          >
            <Choice
              label="Hand machine"
              options={[
                ...(canColocate ? [{ value: brainsMachine, label: "The brain’s machine" }] : []),
                ...machines.map((each) => ({ value: each.id, label: `${each.name}, separate machine` })),
                { value: noTools, label: "No tools" },
              ]}
              value={handValue(hand)}
              disabled={!props.space.canUpdate}
              onChange={(value) => void props.save({ hand: handOf(value) })}
            />
          </Row>,
        ]}
      </Rows>
    </Section>
  )
}

export function SpaceComputeTab(props: { space: SpaceInfo }) {
  const { api } = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const update = useMutation(api.space.update.mutationOptions())
  const space = props.space
  const save: Save = (change) =>
    update.mutateAsync(
      { id: space.id, ...change },
      {
        onSuccess: (updated) =>
          queryClient.setQueryData(api.space.get.queryOptions({ idOrSlug: space.id }).queryKey, updated),
        onError: (error) => toast.error("Could not save the space", { description: errorMessage(error) }),
      },
    )
  return (
    <div className="flex flex-col gap-10">
      <BrainSection space={space} save={save} />
      <HandSection space={space} save={save} />
    </div>
  )
}
