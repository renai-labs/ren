import { IconBrain, IconCube, IconGhostFilled, IconLock, IconUsers } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { FilterMenu, type FilterProperty, type Filters } from "../../components/filter-menu.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMembers } from "../../lib/use-members.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { useNow } from "../../lib/use-now.js"
import { AgentIcon, ModelIcon } from "./usage-lists.js"
import { UsageModel } from "./usage-model.js"
import { UsageQuery } from "./usage-query.js"
import type { UsageSearch } from "./usage-search.js"

const one = (value: string | undefined) => (value ? [value] : [])

export function UsageFilter(props: {
  scope: Insights.Scope
  search: UsageSearch.Search
  onSearchChange: UsageSearch.Change
}) {
  const { api } = RouterContext.useRouterContext()
  const now = useNow()
  const members = useMembers()
  const period = { period: props.search.period }
  const scoped = UsageQuery.scopeOf(props.scope, props.search)
  const keys = (scope: Insights.Scope, by: UsageSearch.Breakdown) =>
    api.insights.query.queryOptions(UsageQuery.breakdown(scope, period, by, now))
  const spaces = useQuery({ ...keys(props.scope, "space"), enabled: !props.scope.spaceId })
  const agents = useQuery({
    ...api.agent.list.queryOptions({
      page: 1,
      pageSize: pickerPageSize,
      isSubagent: false,
      ...(scoped.spaceId && { spaceId: scoped.spaceId }),
    }),
    enabled: Boolean(scoped.spaceId),
  })
  const models = useQuery(keys(scoped, "model"))
  const properties: FilterProperty[] = [
    ...(props.scope.spaceId
      ? []
      : [
          {
            key: "space",
            label: "Space",
            any: "All spaces",
            icon: IconCube,
            single: true,
            options: (spaces.data?.rows ?? []).flatMap((row) =>
              row.key
                ? [
                    {
                      value: row.key,
                      label: row.label ?? row.key,
                      icon: row.label?.startsWith("Private space") ? IconLock : IconCube,
                    },
                  ]
                : [],
            ),
          },
        ]),
    {
      key: "member",
      label: "Member",
      any: "Anyone",
      icon: IconUsers,
      single: true,
      options: members.members.map((member) => ({
        value: member.id,
        label: member.name,
        icon: () => <PersonAvatar name={member.name} image={member.image} />,
      })),
    },
    ...(scoped.spaceId
      ? [
          {
            key: "agent",
            label: "Agent",
            any: "Any agent",
            icon: IconGhostFilled,
            single: true,
            options: (agents.data?.items ?? []).map((agent) => ({
              value: agent.name,
              label: agent.name,
              icon: () => <AgentIcon name={agent.name} />,
            })),
          },
        ]
      : []),
    {
      key: "model",
      label: "Model",
      any: "Any model",
      icon: IconBrain,
      single: true,
      options: (models.data?.rows ?? []).flatMap((row) =>
        row.key
          ? [{ value: row.key, label: UsageModel.short(row.key), icon: () => <ModelIcon model={row.key ?? ""} /> }]
          : [],
      ),
    },
  ]
  const value: Filters = {
    space: one(props.search.space),
    member: one(props.search.member),
    agent: one(props.search.agent),
    model: one(props.search.model),
  }
  return (
    <FilterMenu
      label="Filter usage"
      properties={properties}
      value={value}
      defaults={{ space: [], member: [], agent: [], model: [] }}
      onChange={(next) =>
        props.onSearchChange({
          space: next.space?.[0],
          member: next.member?.[0],
          agent: next.agent?.[0],
          model: next.model?.[0],
        })
      }
    />
  )
}
