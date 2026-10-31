import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconArrowDown, IconArrowUp, IconGhost, IconPlus, IconX } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Row, Rows, Section, SkeletonRows } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { spaceAgentsOptions, useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

export function SpaceFactoryTab() {
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
  const agent = (id: string) => list.find((candidate) => candidate.id === id)
  const available = list.filter((agent) => !order.includes(agent.id))
  const disabled = !space.canUpdate || update.isPending
  const remove = (id: string) => save(order.filter((candidate) => candidate !== id))
  const add = (id: string) => save([...order, id])
  if (loading) return <SkeletonRows count={3} />
  return (
    <div className="flex flex-col gap-8">
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
                media={<IconGhost className="size-4 text-muted-foreground" />}
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
                media={<IconGhost className="size-4 text-muted-foreground" />}
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
