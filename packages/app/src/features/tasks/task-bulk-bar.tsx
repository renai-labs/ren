import type { Task } from "@ren/schema/task"
import { Button } from "@ren/ui/button"
import { Card, CardContent } from "@ren/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Text } from "@ren/ui/text"
import { TaskView } from "./task-view.js"
import type { Tasks } from "./tasks.js"

export function BulkActionBar(props: {
  count: number
  busy: boolean
  agents: ReadonlyArray<Tasks.Agent>
  onStatus: (status: Task.Status) => void
  onMove: (agentId: string | null) => void
  onArchive: () => void
  onClear: () => void
}) {
  if (props.count <= 0) return null
  return (
    <section aria-label="Selected tasks" aria-busy={props.busy}>
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-2">
          <Text purpose="body" element="span" aria-live="polite">
            {props.busy ? `Updating ${props.count}…` : `${props.count} selected`}
          </Text>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={props.busy} />}>
              Change status
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuGroup>
                {TaskView.statuses.map((status) => (
                  <DropdownMenuItem key={status} onClick={() => props.onStatus(status)}>
                    {TaskView.statusLabel[status]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={props.busy} />}>
              Move
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuGroup>
                {props.agents.map((agent) => (
                  <DropdownMenuItem key={agent.id} onClick={() => props.onMove(agent.id)}>
                    {agent.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              {props.agents.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => props.onMove(null)}>No agent</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" disabled={props.busy} onClick={props.onArchive}>
            Archive
          </Button>
          <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onClear}>
            Clear selection
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
