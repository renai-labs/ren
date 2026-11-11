import { useState } from "react"
import type { EnvironmentTemplateInfo, SpaceBrainMachine, SpaceHand, SpaceInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { Row, Rows, Section } from "../../components/page.js"
import { StatusBadge, type StatusTone } from "../../components/status-badge.js"
import { Choice } from "../../components/settings-shared.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Machines } from "../../lib/machines.js"

type Save = (change: {
  brainScope?: SpaceInfo["brainScope"]
  brain?: SpaceBrainMachine
  hand?: SpaceHand
}) => Promise<unknown>

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

const useMachines = (selected: string | null) => {
  const { api, client } = RouterContext.useRouterContext()
  const machines = useQuery(Machines.options(client))
  const current = useQuery({
    ...api["environment-template"].get.queryOptions({ idOrSlug: selected ?? "" }),
    enabled: Boolean(selected),
  })
  return [
    ...(machines.data ?? []),
    ...(current.data && !machines.data?.some((each) => each.id === current.data.id) ? [current.data] : []),
  ].filter((each) => Boolean(each.image) || each.buildStatus === "ready")
}

function BrainSection(props: { space: SpaceInfo; save: Save }) {
  const { api } = RouterContext.useRouterContext()
  const providers = useQuery(api.environmentProvider.brains.queryOptions())
  const brain = props.space.brain
  const machines = useMachines(brain.environmentTemplateId).filter((each) => each.provider === brain.provider)
  return (
    <Section title="Brain" description="Where the agent runs.">
      <Rows>
        {[
          <Row
            key="scope"
            title="Brain scope"
            description="Applies to new chats only. Existing chats keep their brain."
          >
            <Choice
              label="Brain scope"
              options={[
                { value: "space", label: "Per space" },
                { value: "session", label: "Per chat" },
              ]}
              value={props.space.brainScope}
              disabled={!props.space.canUpdate}
              onChange={(scope) => void props.save({ brainScope: scope === "session" ? "session" : "space" })}
            />
          </Row>,
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
  const hand = props.space.hand
  const machines = useMachines(hand.placement === "remote" ? hand.environmentTemplateId : null)
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

const refreshEvery = 5000

const statusOf = (compute: SpaceInfo["compute"]): { tone: StatusTone; label: string } | undefined => {
  if (compute.shutdown === "running") return { tone: "warn", label: "Shutting down" }
  if (compute.isPending) return { tone: "neutral", label: "Change pending" }
  return undefined
}

// oxlint-disable-next-line ren/no-comments -- A change waits for each brain's next wake; a shutdown applies it now, at the cost of the work and files on the space's machines.
function ShutdownSection(props: { space: SpaceInfo }) {
  const { api } = RouterContext.useRouterContext()
  const [confirming, setConfirming] = useState(false)
  const shutdown = useMutation(api.space.shutdown.mutationOptions())
  const space = useQuery({
    ...api.space.get.queryOptions({ idOrSlug: props.space.id }),
    initialData: props.space,
    refetchInterval: (query) => (query.state.data?.compute.shutdown ? refreshEvery : false),
  }).data
  const compute = space.compute
  const isRunning = compute.shutdown === "running"
  const status = statusOf(compute)
  const problems = compute.lastShutdown?.problems ?? []
  return (
    <Section title="Shutdown" description="Brains apply a change to the brain or hand when they next wake.">
      <Rows>
        {[
          <Row
            key="shutdown"
            title="Shut down space"
            badge={status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : undefined}
            description="Stops all work now. Each brain and hand starts again with the space’s settings at the next message."
          >
            <Button
              variant="outline"
              size="sm"
              disabled={!space.canUpdate || isRunning || shutdown.isPending}
              onClick={() => setConfirming(true)}
            >
              {isRunning ? <Spinner data-icon="inline-start" /> : null}
              Shut down space
            </Button>
          </Row>,
          ...(compute.lastShutdown && problems.length > 0
            ? [
                <Row
                  key="report"
                  title="Last shutdown"
                  badge={<StatusBadge tone="error">{`${problems.length} not confirmed`}</StatusBadge>}
                  description={problems.join(" ")}
                />,
              ]
            : []),
        ]}
      </Rows>
      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={setConfirming}
          confirmation={{
            title: `Shut down ${space.name}`,
            description:
              "All work in this space stops. The files on its machines are deleted, and chat changes that were not saved may be lost.",
            action: "Shut down space",
          }}
          onConfirm={() =>
            shutdown.mutateAsync(
              { id: space.id },
              {
                onError: (error) =>
                  toast.error("Couldn’t shut down the space", { description: errorMessage(error), duration: Infinity }),
              },
            )
          }
        />
      ) : null}
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
      <ShutdownSection space={space} />
    </div>
  )
}
