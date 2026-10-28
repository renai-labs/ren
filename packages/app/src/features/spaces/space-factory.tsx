import type { FactoryEdge, FactoryEntry } from "@ren/client"
import { Factory } from "@ren/schema/factory"
import { Pagination } from "@ren/schema/pagination"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Page } from "@ren/ui/page"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Struct } from "effect"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"

const range = (to: number) => Array.from({ length: to }, (_, index) => String(index + 1))

const handoffLimits = ["5", "10", "20", "30", "50", "100"]

const loopLimits = ["1", "2", "3", "5", "10"]

const defaultLoopLimit = 3

const runs = [{ value: "none", label: "No limit" }, ...range(20).map((value) => ({ value, label: value }))]

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
  const update = useMutation(context.api.space.update.mutationOptions())
  if (space.isError || agents.isError)
    return (
      <Empty role="alert">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon glyph="AlertCircle" />
          </EmptyMedia>
          <EmptyTitle>Couldn’t load the factory.</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void space.refetch()
              void agents.refetch()
            }}
          >
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    )
  if (!space.data || !agents.data)
    return (
      <Empty>
        <EmptyMedia>
          <Spinner />
        </EmptyMedia>
      </Empty>
    )
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
    <Page.Section>
      <div className="flex flex-col gap-6">
        {update.isError ? (
          <Alert variant="destructive">
            <Icon glyph="AlertCircle" />
            <AlertTitle>Couldn’t save the factory</AlertTitle>
            <AlertDescription>{update.error.message}</AlertDescription>
          </Alert>
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
    </Page.Section>
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
          size="sm"
          variant="outline"
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
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={props.disabled} />}>
              Add agent
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuGroup>
                {unlisted.map((agent) => (
                  <DropdownMenuItem key={agent.id} onClick={() => props.onChange([...order, { agentId: agent.id }])}>
                    {agent.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {order.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>Add an agent to set the factory order.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup aria-label="Factory" className="gap-0 rounded-xl border bg-card">
          {order.map((entry, index) => (
            <Item
              key={entry.agentId}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Item renders a div in the ItemGroup list
              role="listitem"
              className="items-start rounded-none border-0 not-last:border-b not-last:border-border"
            >
              <ItemMedia>
                <span className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Icon glyph="Bot" />
                </span>
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>{props.name(entry.agentId)}</ItemTitle>
                <AgentHandoffs
                  entry={entry}
                  order={order}
                  positions={positions}
                  name={props.name}
                  disabled={props.disabled}
                  onChange={(next) => props.onChange(order.with(index, next))}
                />
              </ItemContent>
              <ItemActions>
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
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
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
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={`Move ${props.name} up`}
        disabled={props.disabled || !props.onUp}
        onClick={props.onUp}
      >
        <Icon glyph="ArrowUp" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={`Move ${props.name} down`}
        disabled={props.disabled || !props.onDown}
        onClick={props.onDown}
      >
        <Icon glyph="ArrowDown" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={`Remove ${props.name} from the factory`}
        disabled={props.disabled || !props.onRemove}
        onClick={props.onRemove}
      >
        <Icon glyph="X" />
      </Button>
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
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={props.disabled}
                aria-label={`Add a handoff from ${from}`}
              />
            }
          >
            <Icon glyph="Plus" data-icon="inline-start" />
            Add
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuGroup>
              {unlisted.map((other) => (
                <DropdownMenuItem
                  key={other.agentId}
                  onClick={() =>
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
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={props.disabled}
            aria-label={`${label}, handoff from ${props.from}`}
          />
        }
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {props.direction === "back" || edge.max ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Send back at most</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={edge.max ? String(edge.max) : "none"}
              onValueChange={(value: string) =>
                props.onChange(value === "none" ? Struct.omit(edge, ["max", "else"]) : { ...edge, max: Number(value) })
              }
            >
              {[...new Set([...loopLimits, ...(edge.max ? [String(edge.max)] : [])])]
                .toSorted((left, right) => Number(left) - Number(right))
                .map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {value === "1" ? "1 time" : `${value} times`}
                  </DropdownMenuRadioItem>
                ))}
              <DropdownMenuRadioItem value="none">No limit</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ) : null}
        {edge.max ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>At the limit</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={edge.else ?? "person"}
              onValueChange={(value: string) =>
                props.onChange(value === "person" ? Struct.omit(edge, ["else"]) : { ...edge, else: value })
              }
            >
              <DropdownMenuRadioItem value="person">A person decides</DropdownMenuRadioItem>
              {props.others.map((other) => (
                <DropdownMenuRadioItem key={other.agentId} value={other.agentId}>
                  {props.name(other.agentId)} gets the task
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Session</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={edge.start === "new" ? "new" : "continue"}
            onValueChange={(value: string) =>
              props.onChange(value === "new" ? { ...edge, start: "new" } : Struct.omit(edge, ["start"]))
            }
          >
            <DropdownMenuRadioItem value="continue">Continue its session</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="new">Start a new session</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onClick={() => props.onChange(undefined)}>
            Remove handoff
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FactoryAdvanced(props: {
  order: ReadonlyArray<FactoryEntry>
  maxHandoffs: number
  name: (id: string) => string
  disabled: boolean
  onChange: (change: Change) => void
}) {
  const handoffs = [...new Set([...handoffLimits, String(props.maxHandoffs)])]
    .toSorted((left, right) => Number(left) - Number(right))
    .map((value) => ({ value, label: value }))
  return (
    <Collapsible className="flex flex-col gap-3">
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="group/advanced self-start text-muted-foreground" />}
      >
        Advanced
        <span className="flex transition-transform duration-150 ease-out group-data-panel-open/advanced:rotate-180 motion-reduce:transition-none">
          <Icon glyph="ChevronDown" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Text purpose="body">Most handoffs before a person decides</Text>
          <Select
            items={handoffs}
            disabled={props.disabled}
            value={String(props.maxHandoffs)}
            onValueChange={(value) => {
              if (value) props.onChange({ maxHandoffs: Number(value) })
            }}
          >
            <SelectTrigger size="sm" aria-label="Most handoffs before a person decides">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {handoffs.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {props.order.map((entry, index) => (
          <div key={entry.agentId} className="flex flex-wrap items-center gap-2">
            <Text purpose="body">Most runs of {props.name(entry.agentId)}</Text>
            <Select
              items={runs}
              disabled={props.disabled}
              value={entry.maxRuns ? String(entry.maxRuns) : "none"}
              onValueChange={(value) =>
                props.onChange({
                  agents: props.order.with(
                    index,
                    value === "none" || !value ? Struct.omit(entry, ["maxRuns"]) : { ...entry, maxRuns: Number(value) },
                  ),
                })
              }
            >
              <SelectTrigger size="sm" aria-label={`Most runs of ${props.name(entry.agentId)}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {runs.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
