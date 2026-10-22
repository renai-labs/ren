import type { TaskInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { List } from "@ren/ui/list"
import { Notice } from "@ren/ui/notice"
import { Surface } from "@ren/ui/surface"
import { TaskRow } from "@ren/ui/task-row"
import { TaskSubtaskProgress } from "@ren/ui/task-subtask-progress"
import { Text } from "@ren/ui/text"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"
import { AttentionTurn } from "./task-attention.js"
import { TaskComposer } from "./task-create-dialog.js"
import { TaskBadges } from "./task-list.js"
import { OwnerControl, StatusControl } from "./task-controls.js"
import { TaskView } from "./task-view.js"
import { Tasks } from "./tasks.js"

export function TaskSubtasks(props: { task: TaskInfo; catalog: ReturnType<typeof Tasks.useCatalog>; userId: string }) {
  const context = RouterContext.useRouterContext()
  const actions = Tasks.useTaskActions()
  const [adding, setAdding] = useState(false)
  const subtasks = useQuery({
    ...Pages.all((page) =>
      context.api.task.list.queryOptions({
        parentId: props.task.id,
        includeDone: true,
        page,
        pageSize: Pagination.maximumPageSize,
      }),
    ),
    refetchInterval: 5000,
    select: (result) => result.items,
  })
  const items = subtasks.data ?? []
  const counts = props.task.subtasks
  const empty = counts === null && items.length === 0
  return (
    <div className="flex flex-col gap-2">
      {subtasks.isError ? <Notice tone="danger">Couldn’t load sub-tasks.</Notice> : null}
      {empty && props.task.canUpdate && !adding ? (
        <div>
          <Button appearance="plain" size="small" leadingIcon={<Icon glyph="Plus" />} onClick={() => setAdding(true)}>
            Add sub-task
          </Button>
        </div>
      ) : null}
      {empty ? null : (
        <List.Group
          title="Sub-tasks"
          label="Sub-tasks"
          meta={counts?.total ? <TaskSubtaskProgress done={counts.done} total={counts.total} /> : undefined}
          actions={
            props.task.canUpdate ? (
              <IconButton size="compact" label="Add sub-task" disabled={adding} onClick={() => setAdding(true)}>
                <Icon glyph="Plus" />
              </IconButton>
            ) : undefined
          }
        >
          {items.map((subtask) => (
            <SubtaskRow
              key={subtask.id}
              task={subtask}
              catalog={props.catalog}
              userId={props.userId}
              actions={actions}
            />
          ))}
        </List.Group>
      )}
      {adding ? (
        <Surface.Panel>
          <TaskComposer
            spaceId={props.task.spaceId}
            preset={{ parentId: props.task.id }}
            catalog={props.catalog}
            expanded={false}
            pending={actions.isCreating}
            create={actions.create}
            onCreated={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </Surface.Panel>
      ) : null}
    </div>
  )
}

function SubtaskRow(props: {
  task: TaskInfo
  catalog: ReturnType<typeof Tasks.useCatalog>
  userId: string
  actions: ReturnType<typeof Tasks.useTaskActions>
}) {
  const navigate = useNavigate()
  const task = props.task
  const control = {
    task,
    presentation: "icon" as const,
    disabled: !task.canUpdate,
    onChange: (patch: Tasks.Patch) => props.actions.update(task, patch),
  }
  return (
    <TaskRow
      title={task.title}
      badge={<TaskBadges task={task} />}
      onOpen={() => void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } })}
      leading={
        <>
          <StatusControl {...control} />
          <Text purpose="code" tone="secondary" measure="identifier" element="span" title={task.identifier}>
            {task.identifier}
          </Text>
        </>
      }
      turn={
        <AttentionTurn
          task={task}
          owner={TaskView.attentionOwner(task, props.userId, props.catalog.person)}
          turn={{
            ...TaskView.turn(task, {
              agent: props.catalog.agentName,
              owner: (id) => props.catalog.person(id)?.name,
              userId: props.userId,
            }),
            truncation: "single-line",
          }}
        />
      }
      trailing={
        <OwnerControl
          {...control}
          owner={task.ownerId ? props.catalog.person(task.ownerId) : undefined}
          onAssign={(assignment) => props.actions.assign(task, assignment)}
        />
      }
    />
  )
}
