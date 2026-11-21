import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { TaskScopeContext } from "./task-scope-context.js"

export function TaskScopeProvider(props: { spaceId: string | undefined; children: ReactNode }) {
  return <TaskScopeContext.SpaceId value={props.spaceId}>{props.children}</TaskScopeContext.SpaceId>
}

export function TaskLink(props: {
  taskId: string
  className?: string | undefined
  title?: string | undefined
  draggable?: boolean | undefined
  children: ReactNode
}) {
  const spaceId = TaskScopeContext.useSpaceId()
  const anchor = { className: props.className, title: props.title, draggable: props.draggable }
  if (spaceId)
    return (
      <Link to="/spaces/$spaceId/tasks/$taskId" params={{ spaceId, taskId: props.taskId }} {...anchor}>
        {props.children}
      </Link>
    )
  return (
    <Link to="/tasks/$taskId" params={{ taskId: props.taskId }} {...anchor}>
      {props.children}
    </Link>
  )
}

export function TasksLink(props: { children: ReactNode }) {
  const spaceId = TaskScopeContext.useSpaceId()
  if (spaceId)
    return (
      <Link to="/spaces/$spaceId/tasks" params={{ spaceId }}>
        {props.children}
      </Link>
    )
  return <Link to="/tasks">{props.children}</Link>
}
