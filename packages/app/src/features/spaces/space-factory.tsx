import type { FactoryEntry } from "@ren/client"
import { Factory } from "@ren/schema/factory"
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
import { Struct } from "effect"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"

const withoutAgent = (agents: ReadonlyArray<FactoryEntry>, id: string) =>
  agents
    .filter((entry) => entry.agentId !== id)
    .map((entry) =>
      Struct.evolve(entry, {
        to: (to) =>
          (to ?? [])
            .filter((edge) => edge.agentId !== id)
            .map((edge) => (edge.else === id ? Struct.omit(edge, ["else"]) : edge)),
      }),
    )

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
        title="Couldn’t load the factory."
        onRetry={() => {
          void space.refetch()
          void agents.refetch()
        }}
      />
    )
  if (!space.data || !agents.data) return <LoadingMessage placement="section" />
  const factory = space.data.factory
  const order = factory.agents
  const available = agents.data.items
  const names = new Map(available.map((agent) => [agent.id, agent.name]))
  const name = (id: string) => names.get(id) ?? "Archived agent"
  const disabled = !space.data.canUpdate || update.isPending
  const save = (agents: ReadonlyArray<FactoryEntry>) =>
    update.mutate({
      id: space.data.id,
      factory: { maxHandoffs: factory.maxHandoffs ?? Factory.defaultMaxHandoffs, agents: [...agents] },
    })
  return (
    <PageShell.Section>
      <div className="flex flex-col gap-4">
        {update.isError ? (
          <Notice tone="danger" title="Couldn’t save the factory">
            {update.error.message}
          </Notice>
        ) : null}
        <FactoryOrder
          spaceId={space.data.id}
          order={order}
          available={available}
          name={name}
          disabled={disabled}
          onChange={save}
        />
      </div>
    </PageShell.Section>
  )
}

function FactoryOrder(props: {
  spaceId: string
  order: ReadonlyArray<FactoryEntry>
  available: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly ownerSpaceId: string | null
    readonly organizationId: string | null
  }>
  name: (id: string) => string
  disabled: boolean
  onChange: (agents: ReadonlyArray<FactoryEntry>) => void
}) {
  const order = props.order
  const listed = new Set(order.map((entry) => entry.agentId))
  const unlisted = props.available.filter((agent) => !listed.has(agent.id))
  const fallsBackToGlobalAgents = !props.available.some((agent) => agent.ownerSpaceId === props.spaceId)
  const fixedAgentId =
    fallsBackToGlobalAgents &&
    order.length === 1 &&
    props.available.some((agent) => agent.id === order[0]?.agentId && agent.organizationId === null)
      ? order[0]?.agentId
      : undefined
  return (
    <>
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
      <List.Root
        label="Factory order"
        state={order.length ? "ready" : "empty"}
        emptyMessage="Add an agent below to set the factory order."
      >
        {order.map((entry, index) => (
          <List.Item
            key={entry.agentId}
            title={props.name(entry.agentId)}
            leading={<Avatar.Root name={props.name(entry.agentId)} glyph="Bot" size="small" decorative />}
            trailing={
              <OrderActions
                name={props.name(entry.agentId)}
                disabled={props.disabled}
                {...(index > 0 && {
                  onUp: () => props.onChange(order.toSpliced(index - 1, 2, entry, order[index - 1] ?? entry)),
                })}
                {...(index < order.length - 1 && {
                  onDown: () => props.onChange(order.toSpliced(index, 2, order[index + 1] ?? entry, entry)),
                })}
                {...(entry.agentId !== fixedAgentId && {
                  onRemove: () => props.onChange(withoutAgent(order, entry.agentId)),
                })}
              />
            }
          />
        ))}
      </List.Root>
      {unlisted.length > 0 ? (
        <List.Section title="Available agents">
          <List.Root label="Available agents">
            {unlisted.map((agent) => (
              <List.Item
                key={agent.id}
                title={agent.name}
                leading={<Avatar.Root name={agent.name} glyph="Bot" size="small" decorative />}
                trailing={
                  <Button
                    size="small"
                    appearance="outline"
                    disabled={props.disabled}
                    onClick={() => props.onChange([...order, { agentId: agent.id }])}
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
    </>
  )
}

function OrderActions(props: {
  name: string
  disabled: boolean
  onUp?: () => void
  onDown?: () => void
  onRemove?: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      <IconButton
        label={`Move ${props.name} up`}
        size="compact"
        disabled={props.disabled || !props.onUp}
        onClick={props.onUp}
      >
        <Icon glyph="ArrowUp" />
      </IconButton>
      <IconButton
        label={`Move ${props.name} down`}
        size="compact"
        disabled={props.disabled || !props.onDown}
        onClick={props.onDown}
      >
        <Icon glyph="ArrowDown" />
      </IconButton>
      <IconButton
        label={`Remove ${props.name} from factory order`}
        size="compact"
        disabled={props.disabled || !props.onRemove}
        onClick={props.onRemove}
      >
        <Icon glyph="X" />
      </IconButton>
    </div>
  )
}
