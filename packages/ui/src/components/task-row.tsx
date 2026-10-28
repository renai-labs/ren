import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Button } from "./button.js"
import { Icon } from "./icon.js"
import { Text } from "./text.js"

const controls = "button, a, input, select, textarea, label, [role=menuitem], [role=option], [role=checkbox]"

const stemVariants = cva("absolute top-0 left-2 border-l border-border-primary", {
  variants: { branch: { middle: "bottom-0", last: "h-1/2" } },
})

export type TaskRowProps = {
  title: string
  selected?: boolean
  onOpen: () => void
  branch?: "middle" | "last" | undefined
  parent?: string | undefined
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
      {props.branch ? (
        <span aria-hidden="true" data-slot="task-row-branch" className="relative w-5 shrink-0 self-stretch">
          <span className={composeClasses(stemVariants({ branch: props.branch }))} />
          <span className="absolute top-1/2 left-2 w-2.5 border-t border-border-primary" />
        </span>
      ) : null}
      {props.leading}
      <span className="flex min-w-0 items-center gap-2">
        <Button
          variant="link"
          onClick={props.onOpen}
          title={props.title}
          className="h-auto max-w-full min-w-0 shrink justify-start truncate px-0 text-start text-foreground hover:no-underline active:not-aria-[haspopup]:scale-100"
        >
          {props.title}
        </Button>
        {props.parent ? (
          <span className="flex max-w-48 min-w-0 items-center gap-1" title={props.parent}>
            <Icon glyph="ChevronRight" size="extra-small" tone="secondary" />
            <Text purpose="caption" tone="secondary" truncation="single-line" element="span">
              <span className="sr-only">Sub-task of </span>
              {props.parent}
            </Text>
          </span>
        ) : null}
        {props.badge}
      </span>
      <div className="ml-auto hidden max-w-sidebar shrink-0 items-center gap-1 lg:flex">{props.aside}</div>
      {props.turn ? <div className="hidden max-w-60 min-w-0 shrink-0 md:flex">{props.turn}</div> : null}
      <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">{props.trailing}</div>
    </div>
  )
}
