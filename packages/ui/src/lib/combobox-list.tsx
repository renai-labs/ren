import { Combobox } from "@base-ui/react/combobox"
import type { BaseUIEvent } from "@base-ui/react/types"
import { cva } from "class-variance-authority"
import type { KeyboardEvent, KeyboardEventHandler, ReactNode } from "react"
import { Icon } from "../components/icon.js"
import { LoadingMessage } from "../components/loading-message.js"
import { StateMessage } from "../components/state-message.js"
import { RowView } from "./combobox-row.js"
import type { Row, Section, Tree } from "./combobox-tree.js"
import { composeClasses } from "./compose-classes.js"

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

type BodyProps = ListChrome & {
  focusOnMount: boolean
  pickFirstOnEnter: boolean
  tree: Tree
  onSearchKeyDown?: KeyboardEventHandler<HTMLInputElement>
  onTreeKeyDown: (event: BaseUIEvent<KeyboardEvent<HTMLInputElement>>) => void
}

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
        onKeyDown={(event) => {
          props.onSearchKeyDown?.(event)
          if (!event.defaultPrevented) props.onTreeKeyDown(event)
          if (event.defaultPrevented || event.key !== "Enter" || !props.pickFirstOnEnter) return
          if (event.currentTarget.hasAttribute("aria-activedescendant")) return
          const first = event.currentTarget
            .closest('[data-slot="option-list"]')
            ?.querySelector<HTMLElement>('[role="option"]:not([data-disabled], [data-back])')
          if (!first) return
          event.preventDefault()
          event.preventBaseUIHandler()
          first.click()
        }}
        className={composeClasses(
          // oxlint-disable-next-line ren/require-companion-class -- the caret and the highlighted option show focus inside the list
          "size-full bg-transparent placeholder-muted text-text-primary outline-none",
          scale(props) === "medium" ? "text-sm max-sm:text-base" : "text-base",
        )}
      />
    </div>
  )
}

function Results(props: BodyProps) {
  const spacious = props.density === "spacious"
  return (
    <div className={composeClasses(resultsVariants({ scale: scale(props) }))}>
      {props.state === "loading" ? <LoadingMessage placement="inline" /> : null}
      {props.state === "failed" ? (
        <StateMessage state="failed" placement="inline" title={props.failureMessage ?? "Couldn’t load options."} />
      ) : null}
      {props.state === "loading" || props.state === "failed" ? null : (
        <Combobox.Empty
          className={composeClasses(
            "px-3 text-center text-sm text-text-secondary empty:hidden",
            spacious ? "py-8" : "py-6",
          )}
        >
          {props.emptyMessage ?? "No results"}
        </Combobox.Empty>
      )}
      {/* oxlint-disable-next-line ren/require-companion-class -- focus stays in the input; data-highlighted marks the active option */}
      <Combobox.List aria-busy={props.state === "loading" || undefined} className="flex flex-col outline-none">
        {props.state === "loading" || props.state === "failed"
          ? null
          : (group: Section) => (
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
                  {(row: Row) => (
                    <RowView key={row.value} row={row} tree={props.tree} purpose={props.purpose} spacious={spacious} />
                  )}
                </Combobox.Collection>
              </Combobox.Group>
            )}
      </Combobox.List>
    </div>
  )
}
