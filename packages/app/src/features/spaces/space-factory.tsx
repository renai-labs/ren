import type { FactoryEdge, FactoryEntry } from "@ren/client"
import { Factory } from "@ren/schema/factory"
import { Pagination } from "@ren/schema/pagination"
import { Avatar } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Disclosure } from "@ren/ui/disclosure"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { List } from "@ren/ui/list"
import { LoadingMessage } from "@ren/ui/loading-message"
import { Menu } from "@ren/ui/menu"
import { Notice } from "@ren/ui/notice"
import { PageShell } from "@ren/ui/page-shell"
import { Select } from "@ren/ui/select"
import { StateMessage } from "@ren/ui/state-message"
import { Text } from "@ren/ui/text"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Struct } from "effect"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"

const range = (to: number) => Array.from({ length: to }, (_, index) => String(index + 1))

const handoffLimits = ["5", "10", "20", "30", "50", "100"]

const loopLimits = ["1", "2", "3", "5", "10"]

const defaultLoopLimit = 3

interface Change {
  readonly maxHandoffs?: number
  readonly agents?: ReadonlyArray<FactoryEntry>
}

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

const withEdges = (entry: FactoryEntry, to: ReadonlyArray<FactoryEdge>): FactoryEntry =>
  to.length > 0 ? { ...entry, to: [...to] } : Struct.omit(entry, ["to"])

const withHandoff = (entry: FactoryEntry, edge: FactoryEdge) =>
  entry.to?.some((existing) => existing.agentId === edge.agentId)
    ? entry
    : withEdges(entry, [...(entry.to ?? []), edge])

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
  const maxHandoffs = factory.maxHandoffs ?? Factory.defaultMaxHandoffs
  const order = factory.agents
  const available = agents.data.items
  const names = new Map(available.map((agent) => [agent.id, agent.name]))
  const name = (id: string) => names.get(id) ?? "Archived agent"
  const disabled = !space.data.canUpdate || update.isPending
  const save = (next: Change) =>
    update.mutate({
      id: space.data.id,
      factory: { maxHandoffs: next.maxHandoffs ?? maxHandoffs, agents: [...(next.agents ?? order)] },
    })
  return (
    <PageShell.Section>
      <div className="flex flex-col gap-6">
        {update.isError ? (
          <Notice tone="danger" title="Couldn’t save the factory">
            {update.error.message}
          </Notice>
        ) : null}
        <FactoryList
          spaceId={space.data.id}
          order={order}
          available={available}
          name={name}
          disabled={disabled}
          onChange={(next) => save({ agents: next })}
        />
        {order.length > 0 ? (
          <FactoryAdvanced order={order} maxHandoffs={maxHandoffs} name={name} disabled={disabled} onChange={save} />
        ) : null}
      </div>
    </PageShell.Section>
  )
}

function FactoryList(props: {
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
  const positions = new Map(order.map((entry, index) => [entry.agentId, index]))
  const unlisted = props.available.filter((agent) => !listed.has(agent.id))
  const fallsBackToGlobalAgents = !props.available.some((agent) => agent.ownerSpaceId === props.spaceId)
  const fixedAgentId =
    fallsBackToGlobalAgents &&
    order.length === 1 &&
    props.available.some((agent) => agent.id === order[0]?.agentId && agent.organizationId === null)
      ? order[0]?.agentId
      : undefined
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Text purpose="label" element="h2">
          Factory
        </Text>
        <Text purpose="body" tone="secondary">
          Arrange agents in the order they work, and choose who each one hands work to. Task board columns follow this
          order.
        </Text>
      </div>
      {fallsBackToGlobalAgents ? (
        <Text purpose="caption">
          Spaces without their own primary agents use global agents as the default factory order.
        </Text>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="small"
          appearance="outline"
          disabled={props.disabled || order.length < 2}
          onClick={() =>
            props.onChange(
              order.map((entry, index) => {
                const next = order[index + 1]
                return next ? withHandoff(entry, { agentId: next.agentId }) : entry
              }),
            )
          }
        >
          Pass work down the order
        </Button>
        {unlisted.length > 0 ? (
          <Menu.Root>
            <Menu.Trigger
              render={
                <Button size="small" appearance="outline" disabled={props.disabled}>
                  Add agent
                </Button>
              }
            />
            <Menu.Popup alignment="start" width="medium">
              {unlisted.map((agent) => (
                <Menu.Item key={agent.id} onSelect={() => props.onChange([...order, { agentId: agent.id }])}>
                  {agent.name}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Root>
        ) : null}
      </div>
      <List.Root
        label="Factory"
        state={order.length ? "ready" : "empty"}
        emptyMessage="Add an agent to set the factory order."
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
          >
            <AgentHandoffs
              entry={entry}
              order={order}
              positions={positions}
              name={props.name}
              disabled={props.disabled}
              onChange={(next) => props.onChange(order.with(index, next))}
            />
          </List.Item>
        ))}
      </List.Root>
      <Text purpose="caption" tone="secondary">
        ↺ sends the task back. At the limit, a person decides.
      </Text>
    </div>
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
        label={`Remove ${props.name} from the factory`}
        size="compact"
        disabled={props.disabled || !props.onRemove}
        onClick={props.onRemove}
      >
        <Icon glyph="X" />
      </IconButton>
    </div>
  )
}

function AgentHandoffs(props: {
  entry: FactoryEntry
  order: ReadonlyArray<FactoryEntry>
  positions: ReadonlyMap<string, number>
  name: (id: string) => string
  disabled: boolean
  onChange: (entry: FactoryEntry) => void
}) {
  const entry = props.entry
  const from = props.name(entry.agentId)
  const to = entry.to ?? []
  const targets = new Set(to.map((edge) => edge.agentId))
  const unlisted = props.order.filter((other) => other.agentId !== entry.agentId && !targets.has(other.agentId))
  const sendsBack = (agentId: string) => (props.positions.get(agentId) ?? 0) < (props.positions.get(entry.agentId) ?? 0)
  let summary = "Hands off to"
  if (!entry.to) summary = "Hands off to any agent"
  else if (to.length === 0) summary = "Only asks a person"
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Text purpose="caption" tone="secondary" element="span">
        {summary}
      </Text>
      {to.map((edge, index) => (
        <HandoffChip
          key={edge.agentId}
          from={from}
          edge={edge}
          direction={sendsBack(edge.agentId) ? "back" : "forward"}
          others={props.order.filter((other) => other.agentId !== entry.agentId && other.agentId !== edge.agentId)}
          name={props.name}
          disabled={props.disabled}
          onChange={(next) => props.onChange(withEdges(entry, next ? to.with(index, next) : to.toSpliced(index, 1)))}
        />
      ))}
      {unlisted.length > 0 ? (
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                size="small"
                appearance="ghost"
                shape="pill"
                disabled={props.disabled}
                leadingIcon={<Icon glyph="Plus" />}
                aria-label={`Add a handoff from ${from}`}
              >
                Add
              </Button>
            }
          />
          <Menu.Popup alignment="start" width="medium">
            {unlisted.map((other) => (
              <Menu.Item
                key={other.agentId}
                onSelect={() =>
                  props.onChange(
                    withHandoff(
                      entry,
                      sendsBack(other.agentId)
                        ? { agentId: other.agentId, max: defaultLoopLimit }
                        : { agentId: other.agentId },
                    ),
                  )
                }
              >
                {props.name(other.agentId)}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Root>
      ) : null}
    </div>
  )
}

function HandoffChip(props: {
  from: string
  edge: FactoryEdge
  direction: "forward" | "back"
  others: ReadonlyArray<FactoryEntry>
  name: (id: string) => string
  disabled: boolean
  onChange: (edge: FactoryEdge | undefined) => void
}) {
  const edge = props.edge
  const label = [
    props.name(edge.agentId),
    edge.max ? `↺ ${edge.max}×` : "",
    edge.else ? `→ ${props.name(edge.else)}` : "",
    edge.start === "new" ? "· new session" : "",
  ]
    .filter(Boolean)
    .join(" ")
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            size="small"
            appearance="outline"
            shape="pill"
            disabled={props.disabled}
            aria-label={`${label}, handoff from ${props.from}`}
          >
            {label}
          </Button>
        }
      />
      <Menu.Popup alignment="start" width="medium">
        {props.direction === "back" || edge.max ? (
          <Menu.Section label="Send back at most">
            <Menu.RadioGroup
              value={edge.max ? String(edge.max) : "none"}
              onValueChange={(value) =>
                props.onChange(value === "none" ? Struct.omit(edge, ["max", "else"]) : { ...edge, max: Number(value) })
              }
            >
              {[...new Set([...loopLimits, ...(edge.max ? [String(edge.max)] : [])])]
                .toSorted((left, right) => Number(left) - Number(right))
                .map((value) => (
                  <Menu.RadioItem key={value} value={value}>
                    {value === "1" ? "1 time" : `${value} times`}
                  </Menu.RadioItem>
                ))}
              <Menu.RadioItem value="none">No limit</Menu.RadioItem>
            </Menu.RadioGroup>
          </Menu.Section>
        ) : null}
        {edge.max ? (
          <Menu.Section label="At the limit">
            <Menu.RadioGroup
              value={edge.else ?? "person"}
              onValueChange={(value) =>
                props.onChange(value === "person" ? Struct.omit(edge, ["else"]) : { ...edge, else: value })
              }
            >
              <Menu.RadioItem value="person">A person decides</Menu.RadioItem>
              {props.others.map((other) => (
                <Menu.RadioItem key={other.agentId} value={other.agentId}>
                  {props.name(other.agentId)} gets the task
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Section>
        ) : null}
        <Menu.Section label="Session">
          <Menu.RadioGroup
            value={edge.start === "new" ? "new" : "continue"}
            onValueChange={(value) =>
              props.onChange(value === "new" ? { ...edge, start: "new" } : Struct.omit(edge, ["start"]))
            }
          >
            <Menu.RadioItem value="continue">Continue its session</Menu.RadioItem>
            <Menu.RadioItem value="new">Start a new session</Menu.RadioItem>
          </Menu.RadioGroup>
        </Menu.Section>
        <Menu.Separator />
        <Menu.Item tone="danger" onSelect={() => props.onChange(undefined)}>
          Remove handoff
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  )
}

function FactoryAdvanced(props: {
  order: ReadonlyArray<FactoryEntry>
  maxHandoffs: number
  name: (id: string) => string
  disabled: boolean
  onChange: (change: Change) => void
}) {
  return (
    <Disclosure summary="Advanced">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Text purpose="body">Most handoffs before a person decides</Text>
          <Select.Root
            label="Most handoffs before a person decides"
            size="small"
            disabled={props.disabled}
            value={String(props.maxHandoffs)}
            onValueChange={(value) => props.onChange({ maxHandoffs: Number(value) })}
            options={[...new Set([...handoffLimits, String(props.maxHandoffs)])]
              .toSorted((left, right) => Number(left) - Number(right))
              .map((value) => ({ value, label: value }))}
          />
        </div>
        {props.order.map((entry, index) => (
          <div key={entry.agentId} className="flex flex-wrap items-center gap-2">
            <Text purpose="body">Most runs of {props.name(entry.agentId)}</Text>
            <Select.Root
              label={`Most runs of ${props.name(entry.agentId)}`}
              size="small"
              disabled={props.disabled}
              value={entry.maxRuns ? String(entry.maxRuns) : "none"}
              onValueChange={(value) =>
                props.onChange({
                  agents: props.order.with(
                    index,
                    value === "none" ? Struct.omit(entry, ["maxRuns"]) : { ...entry, maxRuns: Number(value) },
                  ),
                })
              }
              options={[{ value: "none", label: "No limit" }, ...range(20).map((value) => ({ value, label: value }))]}
            />
          </div>
        ))}
      </div>
    </Disclosure>
  )
}
