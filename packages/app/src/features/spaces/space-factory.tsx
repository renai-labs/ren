import { Pagination } from "@ren/schema/pagination"
import { Avatar } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { List } from "@ren/ui/list"
import { LoadingMessage } from "@ren/ui/loading-message"
import { Notice } from "@ren/ui/notice"
import { PageShell } from "@ren/ui/page-shell"
import { StateMessage } from "@ren/ui/state-message"
import { Text } from "@ren/ui/text"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"

export function SpaceFactory(props: { spaceId: string }) {
  const context = RouterContext.useRouterContext()
  const client = useQueryClient()
  const space = useQuery(context.api.space.get.queryOptions({ idOrSlug: props.spaceId }))
  const agents = useQuery(
    Pages.all((page) =>
      context.api.agent.list.queryOptions({
        spaceId: props.spaceId,
        isSubagent: false,
        page,
        pageSize: Pagination.maximumPageSize,
      }),
    ),
  )
  const update = useMutation({
    ...context.api.space.update.mutationOptions(),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: context.api.space.get.queryKey() }),
        client.invalidateQueries({ queryKey: context.api.space.list.queryKey() }),
      ]),
  })
  if (space.isError || agents.isError)
    return (
      <StateMessage
        state="failed"
        title="Couldn’t load factory order."
        onRetry={() => {
          void space.refetch()
          void agents.refetch()
        }}
      />
    )
  if (!space.data || !agents.data) return <LoadingMessage placement="section" />
  const order = space.data.agentOrder
  const available = agents.data.items
  const names = new Map(available.map((agent) => [agent.id, agent.name]))
  const fallsBackToGlobalAgents = !available.some((agent) => agent.ownerSpaceId === space.data.id)
  const lastGlobalAgent =
    fallsBackToGlobalAgents &&
    order.length === 1 &&
    available.some((agent) => agent.id === order[0] && agent.organizationId === null)
  const disabled = !space.data.canUpdate || update.isPending
  const save = (agentOrder: ReadonlyArray<string>) => update.mutate({ id: space.data.id, agentOrder: [...agentOrder] })
  return (
    <PageShell.Section>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Text purpose="label" element="h2">
            Factory order
          </Text>
          <Text purpose="body" tone="secondary">
            Arrange agents in the order they work. Task board columns follow this order.
          </Text>
        </div>
        {fallsBackToGlobalAgents ? (
          <Text purpose="caption">
            Spaces without their own primary agents use global agents as the default factory order.
          </Text>
        ) : null}
        {update.isError ? (
          <Notice tone="danger" title="Couldn’t save factory order">
            {update.error.message}
          </Notice>
        ) : null}
        <List.Root
          label="Factory order"
          state={order.length ? "ready" : "empty"}
          emptyMessage="Add an agent below to set the factory order."
        >
          {order.map((id, index) => {
            const name = names.get(id) ?? "Archived agent"
            return (
              <List.Item
                key={id}
                title={name}
                leading={<Avatar.Root name={name} glyph="Bot" size="small" decorative />}
                trailing={
                  <div className="flex items-center gap-1">
                    <IconButton
                      label={`Move ${name} up`}
                      size="compact"
                      disabled={disabled || index === 0}
                      onClick={() => save(order.toSpliced(index - 1, 2, id, order[index - 1] ?? id))}
                    >
                      <Icon glyph="ArrowUp" />
                    </IconButton>
                    <IconButton
                      label={`Move ${name} down`}
                      size="compact"
                      disabled={disabled || index === order.length - 1}
                      onClick={() => save(order.toSpliced(index, 2, order[index + 1] ?? id, id))}
                    >
                      <Icon glyph="ArrowDown" />
                    </IconButton>
                    <IconButton
                      label={`Remove ${name} from factory order`}
                      size="compact"
                      disabled={disabled || lastGlobalAgent}
                      onClick={() => save(order.filter((entry) => entry !== id))}
                    >
                      <Icon glyph="X" />
                    </IconButton>
                  </div>
                }
              />
            )
          })}
        </List.Root>
        {available.some((agent) => !order.includes(agent.id)) ? (
          <List.Section title="Available agents">
            <List.Root label="Available agents">
              {available
                .filter((agent) => !order.includes(agent.id))
                .map((agent) => (
                  <List.Item
                    key={agent.id}
                    title={agent.name}
                    leading={<Avatar.Root name={agent.name} glyph="Bot" size="small" decorative />}
                    trailing={
                      <Button
                        size="small"
                        appearance="outline"
                        disabled={disabled}
                        onClick={() => save([...order, agent.id])}
                        aria-label={`Add ${agent.name} to factory order`}
                      >
                        Add agent
                      </Button>
                    }
                  />
                ))}
            </List.Root>
          </List.Section>
        ) : null}
      </div>
    </PageShell.Section>
  )
}
