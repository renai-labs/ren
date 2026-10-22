import type { Task } from "@ren/schema/task"
import { Button } from "@ren/ui/button"
import { Menu } from "@ren/ui/menu"
import { Surface } from "@ren/ui/surface"
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
    <Surface.Panel
      element="section"
      level="page"
      radius="control"
      padding="small"
      aria-label="Selected tasks"
      aria-busy={props.busy}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Text purpose="body" element="span" aria-live="polite">
          {props.busy ? `Updating ${props.count}…` : `${props.count} selected`}
        </Text>
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button disabled={props.busy} appearance="outline" size="small">
                Change status
              </Button>
            }
          />
          <Menu.Popup alignment="start">
            {TaskView.statuses.map((status) => (
              <Menu.Item key={status} onSelect={() => props.onStatus(status)}>
                {TaskView.statusLabel[status]}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Root>
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button disabled={props.busy} appearance="outline" size="small">
                Move
              </Button>
            }
          />
          <Menu.Popup alignment="start" width="medium">
            {props.agents.map((agent) => (
              <Menu.Item key={agent.id} onSelect={() => props.onMove(agent.id)}>
                {agent.name}
              </Menu.Item>
            ))}
            {props.agents.length > 0 ? <Menu.Separator /> : null}
            <Menu.Item onSelect={() => props.onMove(null)}>No agent</Menu.Item>
          </Menu.Popup>
        </Menu.Root>
        <Button disabled={props.busy} onClick={props.onArchive} appearance="outline" size="small">
          Archive
        </Button>
        <Button disabled={props.busy} onClick={props.onClear} appearance="plain" size="small">
          Clear selection
        </Button>
      </div>
    </Surface.Panel>
  )
}
