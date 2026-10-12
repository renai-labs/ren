import type { ReactElement, ReactNode } from "react"
import { Text } from "../components/text.js"
import { composeClasses } from "./compose-classes.js"
import { InteractiveFrame } from "./interactive-frame.js"
import type { InteractiveTarget } from "./interactive-frame.js"
import { itemVariants, leadingSlot } from "./list-chrome.js"
import type { ListDensity } from "./list-chrome.js"
import { SelectionMark } from "./selection-mark.js"

type ActionsVisibility = "always" | "on-hover" | "labels-on-hover"

export type ItemProps = {
  density?: ListDensity
  leading?: ReactNode
  title: ReactNode
  titleWeight?: "regular" | "medium"
  badge?: ReactNode
  description?: ReactNode
  descriptionPlacement?: "below" | "inline"
  trailing?: ReactNode
  actions?: ReactNode
  actionsVisibility?: ActionsVisibility
  selected?: boolean
  disabled?: boolean
  onActivate?: () => void
  render?: ReactElement
  selectionMark?: "none" | "checkbox" | "radio"
  label?: string
  children?: ReactNode
}

export function Item(props: ItemProps) {
  const selectionMark = props.selectionMark ?? "none"
  return (
    <ItemFrame {...props}>
      {selectionMark === "none" ? null : <SelectionMark kind={selectionMark} checked={props.selected === true} />}
      {props.leading === undefined ? null : <span className={leadingSlot}>{props.leading}</span>}
      <span
        className={composeClasses(
          "flex min-w-0 flex-1",
          props.descriptionPlacement === "inline" ? "items-baseline gap-2" : "flex-col",
        )}
      >
        <Title title={props.title} badge={props.badge} weight={props.titleWeight} />
        {props.description === undefined ? null : (
          <Text
            purpose={props.descriptionPlacement === "inline" ? "body" : "caption"}
            tone="secondary"
            element="span"
            truncation="single-line"
          >
            {props.description}
          </Text>
        )}
        {props.children}
      </span>
      {props.trailing === undefined ? null : (
        <span className="flex shrink-0 items-center gap-2 text-xs text-text-secondary">{props.trailing}</span>
      )}
    </ItemFrame>
  )
}

function ItemFrame(props: ItemProps & { children: ReactNode }) {
  const selected = props.selected === true
  const interactive = props.onActivate !== undefined || props.render !== undefined
  const sharedHover = props.actions !== undefined && interactive
  const labelGroup = props.actionsVisibility === "labels-on-hover" && "group/action-labels"
  const classes = composeClasses(
    itemVariants({
      density: props.density,
      interactive: interactive && !sharedHover,
      selected: selected && !sharedHover && (props.selectionMark ?? "none") === "none",
      disabled: props.disabled === true,
    }),
    sharedHover && "flex-1 cursor-pointer rounded-control",
  )
  return (
    <InteractiveFrame
      frame={{
        role: "listitem",
        className: composeClasses(
          "group/item relative flex min-w-0 items-center",
          sharedHover && "rounded-control pr-2 transition-standard hover:bg-fill-primary",
          sharedHover && selected && "bg-fill-secondary",
          labelGroup,
        ),
      }}
      target={itemTarget(props, classes, composeClasses(classes, labelGroup))}
      actions={<Actions visibility={props.actionsVisibility}>{props.actions}</Actions>}
    >
      {props.children}
    </InteractiveFrame>
  )
}

function Title(props: { title: ReactNode; badge: ReactNode; weight: "regular" | "medium" | undefined }) {
  const text = (
    <Text purpose={props.weight === "medium" ? "label" : "body"} element="span" truncation="single-line">
      {props.title}
    </Text>
  )
  if (props.badge === undefined) return text
  return (
    <span className="flex min-w-0 items-center gap-2">
      {text}
      {props.badge}
    </span>
  )
}

function Actions(props: { visibility: ActionsVisibility | undefined; children: ReactNode }) {
  if (props.children === undefined) return null
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- keeps a click on an action from also activating the row
    <span
      className={composeClasses(
        "flex shrink-0 items-center gap-1",
        (props.visibility ?? "on-hover") === "on-hover" &&
          "opacity-0 transition-standard group-focus-within/item:opacity-100 group-hover/item:opacity-100 has-data-popup-open:opacity-100",
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {props.children}
    </span>
  )
}

function itemTarget(props: ItemProps, className: string, staticClassName: string): InteractiveTarget {
  const selected = props.selected === true
  if (props.render !== undefined) {
    return {
      kind: "link",
      render: props.render,
      props: { "aria-label": props.label, "aria-current": selected ? "page" : undefined, className },
    }
  }
  if (props.onActivate === undefined) return { kind: "static", props: { role: "listitem", className: staticClassName } }
  const radio = props.selectionMark === "radio"
  return {
    kind: "button",
    props: {
      role: radio ? "radio" : undefined,
      "aria-checked": radio ? selected : undefined,
      "aria-label": props.label,
      "aria-pressed": radio ? undefined : selected || undefined,
      disabled: props.disabled === true,
      onClick: props.onActivate,
      className,
    },
  }
}
