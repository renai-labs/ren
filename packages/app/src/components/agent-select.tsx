import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import { ModelChoice } from "@ren/chat"
import { Session } from "@ren/schema/session"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { InputGroupButton } from "@ren/ui/input-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Search } from "@ren/util/search"
import { pickerPageSize } from "../lib/pagination.js"
import { RouterContext } from "../lib/router-context.js"
import { useModels } from "../lib/use-models.js"
import { Webhooks } from "../lib/webhooks.js"
import { MenuSearch } from "./menu-search.js"
import { modelRef } from "./model-picker.js"
import { ProviderMark } from "./provider-mark.js"

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

const modelsProbe = Session.ID.create()

// oxlint-disable-next-line ren/no-comments -- The agent that runs it, in the look of the composer’s model picker. Each choice shows the model it runs, since the agent decides the model.
export function AgentPicker(props: { spaceId: string; value: string; onChange: (agentId: string) => void }) {
  const { api } = RouterContext.useRouterContext()
  const [query, setQuery] = useState("")
  const agents = useQuery(
    api.agent.list.queryOptions({ page: 1, pageSize: pickerPageSize, isSubagent: false, spaceId: props.spaceId }),
  )
  const models = useModels(modelsProbe, props.spaceId)
  const modelOf = (ref: Parameters<typeof ModelChoice.find>[1]) =>
    ModelChoice.find(models.models, ref) ?? ModelChoice.find(models.models, models.fallback)
  const choices = [
    {
      value: Webhooks.defaultAgent,
      name: "Space default",
      description: "The space’s default settings",
      model: modelOf(undefined),
    },
    ...(agents.data?.items ?? [])
      .filter((agent) => agent.organizationId !== null)
      .map((agent) => ({
        value: agent.id,
        name: agent.name,
        description: agent.description,
        model: modelOf(agent.settings.model && modelRef(agent.settings.model)),
      })),
  ]
  const current = choices.find((choice) => choice.value === props.value) ?? choices[0]
  const shown = choices.filter((choice) => Search.matches(query, choice.name, choice.model?.name))
  return (
    <DropdownMenu onOpenChange={(open) => (open ? undefined : setQuery(""))}>
      <DropdownMenuTrigger
        render={<InputGroupButton size="sm" aria-label="Agent" className="pr-1.5 font-normal text-muted-foreground" />}
      >
        {current?.model ? <ProviderMark provider={ModelChoice.vendorOf(current.model)} /> : null}
        {current?.name}
        {current?.model ? (
          <>
            <span aria-hidden>·</span>
            {current.model.name}
          </>
        ) : null}
        <IconChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-80 p-0">
        <MenuSearch value={query} onChange={setQuery} placeholder="Search agents…" separator={false} />
        <DropdownMenuGroup className="max-h-80 scrollbar-thin overflow-y-auto overscroll-contain p-1">
          {shown.map((choice) => (
            <DropdownMenuItem
              key={choice.value}
              onClick={() => props.onChange(choice.value)}
              className="items-center gap-2.5 py-2"
            >
              {choice.model ? <ProviderMark provider={ModelChoice.vendorOf(choice.model)} /> : null}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex h-5 min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium">{choice.name}</span>
                  {choice.model ? <span className="truncate text-muted-foreground">{choice.model.name}</span> : null}
                </span>
                {choice.description ? (
                  <span className="truncate text-xs text-muted-foreground">{choice.description}</span>
                ) : null}
              </span>
              {choice.value === current?.value ? <IconCheck className="text-muted-foreground" /> : null}
            </DropdownMenuItem>
          ))}
          {shown.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No agents match</p>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
