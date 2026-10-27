import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconArrowDown, IconArrowUp, IconGhost, IconPlus, IconX } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Row, Rows, Section, SkeletonRows } from "@/components/ren/page"
import { api, errorMessage } from "@/lib/api"
import { spaceAgentsOptions, useSpace } from "@/routes/space/use-space"

function useSpaceFactory() {
  const space = useSpace()
  const queryClient = useQueryClient()
  const agents = useQuery(spaceAgentsOptions(space.id))
  const update = useMutation(api.space.update.mutationOptions())
  const order = space.agentOrder
  const list = agents.data?.items ?? []
  const save = (agentOrder: ReadonlyArray<string>) =>
    update.mutate(
      { id: space.id, agentOrder: [...agentOrder] },
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
  return {
    loading: agents.isPending,
    order,
    agent: (id: string) => list.find((candidate) => candidate.id === id),
    available: list.filter((agent) => !order.includes(agent.id)),
    disabled: !space.canUpdate || update.isPending,
    move: swap,
    remove: (id: string) => save(order.filter((candidate) => candidate !== id)),
    add: (id: string) => save([...order, id]),
  }
}

export function SpaceFactoryTab() {
  const page = useSpaceFactory()
  if (page.loading) return <SkeletonRows count={3} />
  return (
    <div className="flex flex-col gap-8">
      <Section title="Factory order" description="Agents in the order the task board shows them.">
        {page.order.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add an agent below to set the factory order.</p>
        ) : (
          <Rows>
            {page.order.map((id, index) => (
              <Row
                key={id}
                title={page.agent(id)?.name ?? "Archived agent"}
                description={page.agent(id)?.description ?? undefined}
                media={<IconGhost className="size-4 text-muted-foreground" />}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move up"
                  disabled={page.disabled || index === 0}
                  onClick={() => page.move(index, -1)}
                >
                  <IconArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move down"
                  disabled={page.disabled || index === page.order.length - 1}
                  onClick={() => page.move(index, 1)}
                >
                  <IconArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove"
                  disabled={page.disabled}
                  onClick={() => page.remove(id)}
                >
                  <IconX />
                </Button>
              </Row>
            ))}
          </Rows>
        )}
      </Section>
      <Section title="Available agents">
        {page.available.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every agent this space can use is in the factory.</p>
        ) : (
          <Rows>
            {page.available.map((candidate) => (
              <Row
                key={candidate.id}
                title={candidate.name}
                description={candidate.description ?? undefined}
                media={<IconGhost className="size-4 text-muted-foreground" />}
              >
                <Button variant="outline" size="sm" disabled={page.disabled} onClick={() => page.add(candidate.id)}>
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
