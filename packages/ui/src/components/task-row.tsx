import type { ReactNode } from "react"
import { Button } from "./button.js"

const controls = "button, a, input, select, textarea, label, [role=menuitem], [role=option], [role=checkbox]"

export type TaskRowProps = {
  title: string
  selected?: boolean
  onOpen: () => void
  selection?: ReactNode
  leading?: ReactNode
  badge?: ReactNode
  aside?: ReactNode
  turn?: ReactNode
  trailing?: ReactNode
}

export function TaskRow(props: TaskRowProps) {
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions -- the title button opens the task from the keyboard, so a click on the row’s empty space is only a pointer shortcut
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the row sits in List.Group, whose list is a div
      role="listitem"
      data-slot="task-row"
      data-selected={props.selected || undefined}
      onClick={(event) => {
        const target = event.target
        if (!(target instanceof Element) || !event.currentTarget.contains(target) || target.closest(controls)) return
        if (target.ownerDocument.getSelection()?.isCollapsed === false) return
        props.onOpen()
      }}
      className="group/task-row flex min-h-11 min-w-0 items-center gap-2 rounded-control px-2 transition-standard hover:bg-fill-primary data-selected:bg-fill-primary"
    >
      {props.selection ? <div className="flex shrink-0">{props.selection}</div> : null}
      {props.leading}
      <span className="flex min-w-0 items-center gap-2">
        <Button appearance="text" onClick={props.onOpen} title={props.title}>
          {props.title}
        </Button>
        {props.badge}
      </span>
      <div className="ml-auto hidden max-w-sidebar shrink-0 items-center gap-1 lg:flex">{props.aside}</div>
      {props.turn ? <div className="hidden max-w-60 min-w-0 shrink-0 md:flex">{props.turn}</div> : null}
      <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">{props.trailing}</div>
    </div>
  )
}
