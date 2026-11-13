import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconArrowBackUp,
  IconArrowDown,
  IconArrowUp,
  IconChevronRight,
  IconFlagCheck,
  IconGhostFilled,
  IconPlus,
  IconX,
} from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Row, Rows, RowsSample, Section, useShapeId } from "../../components/page.js"
import { Loading } from "@ren/ui/loading"
import { errorMessage } from "../../lib/errors.js"
import { spaceAgentsOptions, useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

type FactoryAgent = ReturnType<typeof useSpace>["factory"]["agents"][number]

function FactoryGraph(props: { entries: ReadonlyArray<FactoryAgent>; name: (id: string) => string }) {
  const order = props.entries.map((entry) => entry.agentId)
  const handoffs = props.entries.flatMap((entry) =>
    (entry.to ?? [])
      .filter((edge) => order.indexOf(edge.agentId) !== order.indexOf(entry.agentId) + 1)
      .map((edge) => ({ from: entry.agentId, edge })),
  )
  const finishers = props.entries.filter((entry) => entry.finish).map((entry) => entry.agentId)
  return (
    <figure aria-label="Factory flow" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-y-3">
        {props.entries.map((entry, index) => (
          <span key={entry.agentId} className="flex items-center">
            {index > 0 ? (
              <span aria-hidden className="flex items-center px-2 text-muted-foreground">
                <span className="h-px w-6 bg-border" />
                <IconChevronRight className="-ml-1.5 size-4" />
              </span>
            ) : null}
            <span className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
              <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="font-medium">{props.name(entry.agentId)}</span>
              {entry.maxRuns ? (
                <span className="text-xs text-muted-foreground tabular-nums">≤{entry.maxRuns} runs</span>
              ) : null}
              {entry.finish ? <IconFlagCheck aria-label="Can finish" className="size-4 text-muted-foreground" /> : null}
            </span>
          </span>
        ))}
      </div>
      {handoffs.length > 0 || finishers.length > 0 ? (
        <figcaption className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {finishers.map((id) => (
            <span key={`${id}-finish`} className="flex items-center gap-1 rounded-full border px-2 py-0.5">
              <IconFlagCheck className="size-3.5" />
              {props.name(id)} → Finish
            </span>
          ))}
          {handoffs.map((handoff) => (
            <span
              key={`${handoff.from}-${handoff.edge.agentId}`}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5"
            >
              <IconArrowBackUp className="size-3.5" />
              {props.name(handoff.from)} → {props.name(handoff.edge.agentId)}
              {handoff.edge.max ? <span className="tabular-nums">· up to {handoff.edge.max}×</span> : null}
              {handoff.edge.else ? <span>· then {props.name(handoff.edge.else)}</span> : null}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  )
}

export function SpaceAgentsTab() {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const queryClient = useQueryClient()
  const agents = useQuery(spaceAgentsOptions(api, space.id))
  const update = useMutation(api.space.update.mutationOptions())
  const order = space.factory.agents.map((entry) => entry.agentId)
  const list = agents.data?.items ?? []
  const entries = new Map(space.factory.agents.map((entry) => [entry.agentId, entry]))
  const save = (ids: ReadonlyArray<string>) =>
    update.mutate(
      {
        id: space.id,
        factory: {
          ...(space.factory.maxHandoffs && { maxHandoffs: space.factory.maxHandoffs }),
          agents: ids.map((id) => entries.get(id) ?? { agentId: id }),
        },
      },
      {
        onSuccess: (updated) =>
          queryClient.setQueryData(api.space.get.queryOptions({ idOrSlug: space.id }).queryKey, updated),
        onError: (error) => toast.error("Couldn’t save factory order", { description: errorMessage(error) }),
      },
    )
  const swap = (index: number, by: number) => {
    const next = [...order]
    const here = next[index]
    const there = next[index + by]
    if (here === undefined || there === undefined) return
    next[index] = there
    next[index + by] = here
    save(next)
  }
  const loading = agents.isPending
  const shapeId = useShapeId("agents")
  const agent = (id: string) => list.find((candidate) => candidate.id === id)
  const available = list.filter((agent) => !order.includes(agent.id))
  const disabled = !space.canUpdate || update.isPending
  const remove = (id: string) => save(order.filter((candidate) => candidate !== id))
  const add = (id: string) => save([...order, id])
  if (loading)
    return (
      <Loading id={shapeId} label="Loading agents">
        <Section title="Factory order" description="Agents in the order the task board shows them.">
          <RowsSample count={3} />
        </Section>
      </Loading>
    )
  return (
    <div className="flex flex-col gap-8">
      {order.length > 1 ? (
        <FactoryGraph entries={space.factory.agents} name={(id) => agent(id)?.name ?? "Archived agent"} />
      ) : null}
      <Section title="Factory order" description="Agents in the order the task board shows them.">
        {order.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add an agent below to set the factory order.</p>
        ) : (
          <Rows>
            {order.map((id, index) => (
              <Row
                key={id}
                title={agent(id)?.name ?? "Archived agent"}
                description={agent(id)?.description ?? undefined}
                media={<IconGhostFilled className="size-4 text-muted-foreground" />}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move up"
                  disabled={disabled || index === 0}
                  onClick={() => swap(index, -1)}
                >
                  <IconArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move down"
                  disabled={disabled || index === order.length - 1}
                  onClick={() => swap(index, 1)}
                >
                  <IconArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove"
                  disabled={disabled}
                  onClick={() => remove(id)}
                >
                  <IconX />
                </Button>
              </Row>
            ))}
          </Rows>
        )}
      </Section>
      <Section title="Available agents">
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every agent this space can use is in the factory.</p>
        ) : (
          <Rows>
            {available.map((candidate) => (
              <Row
                key={candidate.id}
                title={candidate.name}
                description={candidate.description ?? undefined}
                media={<IconGhostFilled className="size-4 text-muted-foreground" />}
              >
                <Button variant="outline" size="sm" disabled={disabled} onClick={() => add(candidate.id)}>
                  <IconPlus />
                  Add
                </Button>
              </Row>
            ))}
          </Rows>
        )}
      </Section>
    </div>
  )
}
