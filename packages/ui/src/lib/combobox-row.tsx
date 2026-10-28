import { Combobox } from "@base-ui/react/combobox"
import type { ReactNode } from "react"
import { Icon } from "../components/icon.js"
import { Spinner } from "../components/spinner.js"
import type { Option, Row, Tree } from "./combobox-tree.js"
import { composeClasses } from "./compose-classes.js"
import { optionRow } from "./control-chrome.js"
import { toneText } from "./tone.js"

const spaciousRow =
  // oxlint-disable-next-line ren/require-companion-class -- focus stays in the input; data-highlighted marks the active option
  "relative flex h-11 cursor-default items-center gap-3 rounded-control px-3 text-sm text-text-primary outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-disabled data-highlighted:bg-fill-secondary [&_svg]:shrink-0"

type RowProps = { row: Row; tree: Tree; purpose?: "selection" | "command" | undefined; spacious: boolean }

export function RowView(props: RowProps) {
  const row = props.row
  if (row.kind === "back")
    return (
      <Action value={row.value} spacious={props.spacious} back onAct={props.tree.back}>
        <Content icon={<Icon glyph="ChevronLeft" tone="secondary" />}>
          {row.label}
          <span className="sr-only">, back</span>
        </Content>
      </Action>
    )
  if (row.kind === "create" || row.kind === "step") return <Creatable {...props} row={row} />
  if (row.option.options)
    return (
      <Action
        value={row.value}
        spacious={props.spacious}
        branch
        disabled={row.option.disabled}
        onAct={() => props.tree.drill(row.value)}
      >
        <Content icon={row.option.icon} description={row.option.description} detail={row.option.detail}>
          {row.option.label}
        </Content>
      </Action>
    )
  return <Leaf {...props} option={row.option} ancestors={row.ancestors} />
}

function Leaf(props: RowProps & { option: Option; ancestors: readonly string[] }) {
  const selection = props.purpose !== "command"
  return (
    <Combobox.Item
      value={props.option.value}
      disabled={props.option.disabled}
      className={props.spacious ? spaciousRow : composeClasses(optionRow, selection && "pr-8")}
    >
      <Content icon={props.option.icon} description={props.option.description} detail={props.option.detail}>
        {props.ancestors.length > 0 ? (
          <span className="text-text-secondary">{`${props.ancestors.join(" › ")} › `}</span>
        ) : null}
        {props.option.label}
      </Content>
      {selection ? (
        <Combobox.ItemIndicator
          className={props.spacious ? "flex items-center [&_svg]:size-3.5" : "absolute right-2 flex items-center"}
        >
          <Icon glyph="Check" />
        </Combobox.ItemIndicator>
      ) : null}
    </Combobox.Item>
  )
}

function Creatable(props: RowProps & { row: Extract<Row, { kind: "create" | "step" }> }) {
  const row = props.row
  const option = row.kind === "step" ? row.option : undefined
  const creation = props.tree.creation?.row === row.value ? props.tree.creation : null
  const failure = creation?.state === "failed" ? creation.message : undefined
  const pending = creation?.state === "pending"
  return (
    <Action
      value={row.value}
      spacious={props.spacious}
      disabled={props.tree.creation?.state === "pending" || option?.disabled}
      busy={pending}
      onAct={() => props.tree.create(row)}
    >
      <Content
        icon={<CreateIcon pending={pending} option={option} />}
        description={failure ?? option?.description}
        failed={failure !== undefined}
      >
        {row.label}
      </Content>
    </Action>
  )
}

function CreateIcon(props: { pending: boolean; option: Option | undefined }) {
  if (props.pending) return <Spinner aria-hidden className="text-text-secondary" />
  return props.option?.icon ?? <Icon glyph="Plus" tone="secondary" />
}

function Action(props: {
  value: string
  spacious: boolean
  back?: boolean
  branch?: boolean
  disabled?: boolean | undefined
  busy?: boolean
  onAct: () => void
  children: ReactNode
}) {
  return (
    <Combobox.Item
      value={props.value}
      disabled={props.disabled}
      aria-busy={props.busy || undefined}
      data-back={props.back || undefined}
      onClick={(event) => {
        event.preventBaseUIHandler()
        props.onAct()
      }}
      onMouseUp={(event) => event.preventBaseUIHandler()}
      className={props.spacious ? spaciousRow : composeClasses(optionRow, props.branch && "pr-8")}
    >
      {props.children}
      {props.branch ? (
        <span className={props.spacious ? "flex items-center" : "absolute right-2 flex items-center"}>
          <Icon glyph="ChevronRight" tone="secondary" />
        </span>
      ) : null}
    </Combobox.Item>
  )
}

function Content(props: {
  icon?: ReactNode
  description?: ReactNode
  detail?: ReactNode
  failed?: boolean
  children: ReactNode
}) {
  return (
    <>
      {props.icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{props.children}</span>
        {props.description ? (
          <span className={composeClasses("truncate text-xs", props.failed ? toneText.danger : toneText.secondary)}>
            {props.description}
          </span>
        ) : null}
      </span>
      {props.detail ? <span className="shrink-0 text-xs text-text-secondary">{props.detail}</span> : null}
    </>
  )
}
