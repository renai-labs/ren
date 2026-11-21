import { useQuery } from "@tanstack/react-query"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { pickerPageSize } from "../lib/pagination.js"
import { RouterContext } from "../lib/router-context.js"
import { Webhooks } from "../lib/webhooks.js"

export function AgentSelect(props: {
  spaceId: string
  value: string
  onChange: (agentId: string) => void
  className?: string
}) {
  const { api } = RouterContext.useRouterContext()
  const agents = useQuery(
    api.agent.list.queryOptions({ page: 1, pageSize: pickerPageSize, isSubagent: false, spaceId: props.spaceId }),
  )
  const options = [
    { value: Webhooks.defaultAgent, label: "Space default" },
    ...(agents.data?.items ?? [])
      .filter((agent) => agent.organizationId !== null)
      .map((agent) => ({ value: agent.id, label: agent.name })),
  ]
  return (
    <Select items={options} value={props.value} onValueChange={(value) => props.onChange(String(value))}>
      <SelectTrigger aria-label="Agent" className={props.className ?? "w-full"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
