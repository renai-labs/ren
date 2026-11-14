import { useState, type ReactNode } from "react"
import type { AgentInfo } from "@ren/client"
import { Session } from "@ren/schema/session"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { IconArchive, IconEye, IconGhostFilled, IconPencil, IconPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { toast } from "@ren/ui/sonner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs } from "@ren/ui/tabs"
import { EmptyState } from "../../components/empty-state.js"
import { modelRef } from "../../components/model-picker.js"
import {
  PageActions,
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  TableCard,
  TableEmpty,
  TableSample,
  useShapeId,
} from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { Agents } from "../../lib/agents.js"
import { errorMessage } from "../../lib/errors.js"
import { modelKey } from "../../lib/format.js"
import { RouterContext } from "../../lib/router-context.js"
import { Search } from "../../lib/search.js"
import { useSpaces } from "../../lib/use-spaces.js"

const modelsProbe = Session.ID.create()

const columns = ["Name", "Type", "Model", "Source", ""]

function AgentRow(props: { agent: AgentInfo; spaceId: string; model: string; source: string }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const archive = useMutation(api.agent.archive.mutationOptions())
  const agent = props.agent
  const open = () =>
    void navigate({ to: "/spaces/$spaceId/agents/$agentId", params: { spaceId: props.spaceId, agentId: agent.id } })
  return (
    <TableRow className="relative cursor-pointer">
      <TableCell>
        <span className="flex min-w-0 items-center gap-2.5">
          <IconGhostFilled className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <Link
              to="/spaces/$spaceId/agents/$agentId"
              params={{ spaceId: props.spaceId, agentId: agent.id }}
              className="truncate outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
            >
              {agent.name}
            </Link>
            {agent.description ? (
              <span className="truncate text-xs text-muted-foreground" title={agent.description}>
                {agent.description}
              </span>
            ) : null}
          </span>
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">{agent.isSubagent ? "Subagent" : "Agent"}</TableCell>
      <TableCell className="truncate text-muted-foreground" title={props.model}>
        {props.model}
      </TableCell>
      <TableCell className="truncate text-muted-foreground" title={props.source}>
        {props.source}
      </TableCell>
      <TableCell>
        <span className="relative flex justify-end">
          <RowMenu
            label={`${agent.name} actions`}
            className="flex text-muted-foreground"
            items={
              agent.canUpdate
                ? [
                    { label: "Edit", icon: IconPencil, onSelect: open },
                    {
                      label: "Archive",
                      icon: IconArchive,
                      onSelect: () =>
                        archive.mutateAsync(
                          { id: agent.id },
                          {
                            onSuccess: () => toast.success(`${agent.name} archived`),
                            onError: (error) =>
                              toast.error("Couldn’t archive the agent", { description: errorMessage(error) }),
                          },
                        ),
                      confirm: Agents.archiveConfirmation(agent),
                    },
                  ]
                : [{ label: "View", icon: IconEye, onSelect: open }]
            }
          />
        </span>
      </TableCell>
    </TableRow>
  )
}

function CustomAgents(props: { spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const agents = useQuery(Agents.listOptions(api, props.spaceId))
  const models = useQuery(api.chat.models.queryOptions({ id: modelsProbe }))
  const spaces = useSpaces()
  const [query, setQuery] = useState("")
  const shapeId = useShapeId("agents")
  const items = agents.data?.items.filter((agent) => agent.ownerSpaceId !== null)
  const shown = (items ?? []).filter((agent) => Search.matches(query, agent.name, agent.description))
  const names = new Map((models.data?.models ?? []).map((model) => [modelKey(model), model.name]))
  const modelOf = (agent: AgentInfo) => {
    const model = agent.settings.model
    if (model) return names.get(modelKey(modelRef(model))) ?? model.modelId
    return agent.isSubagent ? "Parent agent’s model" : "Space default"
  }
  const create = () => void navigate({ to: "/spaces/$spaceId/agents/new", params: { spaceId: props.spaceId } })
  return (
    <>
      <PageActions>
        <ToolbarSearch label="Search agents" value={query} onChange={setQuery} />
        <Button onClick={create}>
          <IconPlus data-icon="inline-start" />
          New agent
        </Button>
      </PageActions>
      <Loading id={shapeId} loading={!items} label="Loading agents">
        {items ? null : <TableSample columns={columns} count={3} />}
        {items && items.length === 0 ? (
          <EmptyState
            title="No custom agents yet"
            action={
              <Button onClick={create}>
                <IconPlus data-icon="inline-start" />
                New agent
              </Button>
            }
          >
            Give an agent its own instructions and model for the work in this space.
          </EmptyState>
        ) : null}
        {items && items.length > 0 ? (
          <TableCard>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24">Type</TableHead>
                  <TableHead className="w-36">Model</TableHead>
                  <TableHead className="w-36">Source</TableHead>
                  <TableHead className="w-15" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.length === 0 ? (
                  <TableEmpty columns={columns.length}>{Search.empty(query, "No custom agents yet.")}</TableEmpty>
                ) : null}
                {shown.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    spaceId={props.spaceId}
                    model={modelOf(agent)}
                    source={Agents.source(agent, props.spaceId, (id) => spaces.space(id)?.name)}
                  />
                ))}
              </TableBody>
            </Table>
          </TableCard>
        ) : null}
      </Loading>
    </>
  )
}

export function AgentsView(props: {
  spaceId: string
  tab: "custom" | "factory"
  onTab: (tab: "custom" | "factory") => void
  factory: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageTabs>
        <Tabs
          value={props.tab}
          onValueChange={(value: string) => props.onTab(value === "factory" ? "factory" : "custom")}
        >
          <PageTabsList>
            <PageTabsTrigger value="custom">Custom</PageTabsTrigger>
            <PageTabsTrigger value="factory">Factory</PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      </PageTabs>
      {props.tab === "factory" ? props.factory : <CustomAgents spaceId={props.spaceId} />}
    </div>
  )
}
