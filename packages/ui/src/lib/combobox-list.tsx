import { Combobox } from "@base-ui/react/combobox"
import { cva } from "class-variance-authority"
import type { KeyboardEvent, ReactNode } from "react"
import { Icon } from "../components/icon.js"
import { LoadingMessage } from "../components/loading-message.js"
import { StateMessage } from "../components/state-message.js"
import { composeClasses } from "./compose-classes.js"
import { optionRow } from "./control-chrome.js"

export type Option = {
  value: string
  label: string
  description?: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  keywords?: readonly string[]
}

export type Group = {
  value: string
  label?: ReactNode
  items: readonly Option[]
}

export type ListChrome = {
  label: string
  state?: "ready" | "loading" | "failed"
  searchPlaceholder?: string
  searchIcon?: ReactNode
  searchSize?: "medium" | "large"
  emptyMessage?: ReactNode
  failureMessage?: ReactNode
  header?: ReactNode
  footer?: ReactNode
  purpose?: "selection" | "command"
  density?: "regular" | "spacious"
}

const searchVariants = cva("flex shrink-0 items-center gap-2 border-b border-border-primary", {
  variants: { scale: { medium: "h-9 px-3", large: "h-11 px-4", spacious: "h-14 px-4" } },
})

const resultsVariants = cva("min-h-0 flex-1 overflow-y-auto overscroll-contain", {
  variants: { scale: { medium: "p-1", large: "px-2 py-1", spacious: "p-2" } },
})

function scale(props: ListChrome) {
  if (props.density === "spacious") return "spacious"
  return props.searchSize ?? "medium"
}

type BodyProps = ListChrome & { focusOnMount: boolean; onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void }

export function Body(props: BodyProps) {
  return (
    <>
      <Search {...props} />
      {props.header && props.density === "spacious" ? (
        <div className="flex min-h-7 shrink-0 items-center border-b border-border-primary px-3 text-xs text-text-secondary">
          {props.header}
        </div>
      ) : (
        props.header
      )}
      <Results {...props} />
      {props.footer ? (
        <div
          className={composeClasses(
            "shrink-0 border-t border-border-primary",
            props.searchSize === "large" ? "px-2 py-1" : "p-1",
          )}
        >
          {props.footer}
        </div>
      ) : null}
    </>
  )
}

function Search(props: BodyProps) {
  const spacious = props.density === "spacious"
  return (
    <div className={composeClasses(searchVariants({ scale: scale(props) }))}>
      {spacious ? null : (props.searchIcon ?? <Icon glyph="Search" tone="secondary" />)}
      <Combobox.Input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- inline and panel lists take focus as their dialog opens
        autoFocus={props.focusOnMount}
        placeholder={props.searchPlaceholder ?? "Search…"}
        aria-label={props.label}
        onKeyDown={props.onKeyDown}
        className={composeClasses(
          // oxlint-disable-next-line ren/require-companion-class -- the caret and the highlighted option show focus inside the list
          "size-full bg-transparent placeholder-muted text-text-primary outline-none",
          scale(props) === "medium" ? "text-sm max-sm:text-base" : "text-base",
        )}
      />
    </div>
  )
}

function Results(props: ListChrome) {
  const spacious = props.density === "spacious"
  return (
    <div className={composeClasses(resultsVariants({ scale: scale(props) }))}>
      {props.state === "loading" ? <LoadingMessage placement="inline" /> : null}
      {props.state === "failed" ? (
        <StateMessage state="failed" placement="inline" title={props.failureMessage ?? "Couldn’t load options."} />
      ) : null}
      {props.state === "loading" || props.state === "failed" ? null : (
        <>
          <Combobox.Empty
            className={composeClasses(
              "px-3 text-center text-sm text-text-secondary empty:hidden",
              spacious ? "py-8" : "py-6",
            )}
          >
            {props.emptyMessage ?? "No results"}
          </Combobox.Empty>
          {/* oxlint-disable-next-line ren/require-companion-class -- focus stays in the input; data-highlighted marks the active option */}
          <Combobox.List className="flex flex-col outline-none">
            {(group: Group) => (
              <Combobox.Group
                key={group.value}
                items={[...group.items]}
                className={composeClasses("flex flex-col", spacious && "not-first:pt-3")}
              >
                {group.label ? (
                  <Combobox.GroupLabel
                    className={
                      spacious
                        ? "px-2 pb-2 text-2xs font-reading-semibold text-text-secondary uppercase"
                        : "px-2 pt-2 pb-1 text-xs text-text-secondary"
                    }
                  >
                    {group.label}
                  </Combobox.GroupLabel>
                ) : null}
                <Combobox.Collection>
                  {(item: Option) => <Row key={item.value} item={item} purpose={props.purpose} spacious={spacious} />}
                </Combobox.Collection>
              </Combobox.Group>
            )}
          </Combobox.List>
        </>
      )}
    </div>
  )
}

function Row(props: { item: Option; purpose: ListChrome["purpose"]; spacious: boolean }) {
  const selection = props.purpose !== "command"
  return (
    <Combobox.Item
      value={props.item.value}
      disabled={props.item.disabled}
      className={
        props.spacious
          ? // oxlint-disable-next-line ren/require-companion-class -- focus stays in the input; data-highlighted marks the active option
            "relative flex h-11 cursor-default items-center gap-3 rounded-control px-3 text-sm text-text-primary outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-disabled data-highlighted:bg-fill-secondary [&_svg]:shrink-0"
          : composeClasses(optionRow, selection && "pr-8")
      }
    >
      {props.item.icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{props.item.label}</span>
        {props.item.description ? (
          <span className="truncate text-xs text-text-secondary">{props.item.description}</span>
        ) : null}
      </span>
      {props.item.detail ? <span className="shrink-0 text-xs text-text-secondary">{props.item.detail}</span> : null}
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
