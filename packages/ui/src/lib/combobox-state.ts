import type { BaseUIEvent } from "@base-ui/react/types"
import { useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { parentOf, sections, settle } from "./combobox-tree.js"
import type { CreateStep, Creation, Group, Row, Tree } from "./combobox-tree.js"

export type Selection =
  | {
      selection?: "single"
      value?: string | null
      defaultValue?: string | null
      onValueChange?: (value: string | null) => void
    }
  | {
      selection: "multiple"
      value?: readonly string[]
      defaultValue?: readonly string[]
      onValueChange?: (value: string[]) => void
    }

export type Create = (query: string, step?: string) => string | void | Promise<string | void>

export function useTree(input: {
  groups: readonly Group[]
  query?: string
  onQueryChange?: (query: string) => void
  createLabel?: ((query: string) => string) | undefined
  createStep?: CreateStep
  onCreate?: Create
  select: (value: string) => void
}) {
  const [path, setPath] = useState<readonly string[]>([])
  const [draft, setDraft] = useState<string | null>(null)
  const [ownQuery, setOwnQuery] = useState("")
  const highlighted = useRef<string | undefined>(undefined)
  const typed = input.query ?? ownQuery
  const query = typed.trim()
  const changeQuery = (next: string) => {
    setOwnQuery(next)
    input.onQueryChange?.(next)
  }
  const createLabel = input.onCreate ? (input.createLabel ?? ((name: string) => `Create “${name}”`)) : undefined
  const view = sections({ ...input, query, path, draft, createLabel })
  const nested = typed === "" && (path.length > 0 || draft !== null)
  const creation = useCreation(input.onCreate, (created) => {
    setPath([])
    setDraft(null)
    changeQuery("")
    if (typeof created === "string") input.select(created)
  })
  const reset = () => {
    setPath([])
    setDraft(null)
    creation.clear()
  }
  const commit = creation.commit
  const tree: Tree = {
    creation: creation.state && (draft !== null || creation.state.name === query) ? creation.state : null,
    drill: (value) => setPath((current) => [...current, value]),
    back: () => {
      if (draft === null) return setPath((current) => current.slice(0, -1))
      changeQuery(draft)
      setDraft(null)
      creation.clear()
    },
    create: (row) => {
      if (row.kind === "step" && draft !== null) return commit(draft, row.value, row.option.value)
      if (!input.createStep) return commit(query, row.value)
      setDraft(query)
      changeQuery("")
    },
  }
  return {
    sections: view,
    tree,
    query: typed,
    changeQuery,
    nested,
    highlight: (value: string | undefined) => {
      highlighted.current = value
    },
    picked: (previous: readonly string[], next: readonly string[]) => {
      const added = next.find((value) => !previous.includes(value))
      const parent = added === undefined ? undefined : parentOf(input.groups, added)
      if (parent?.selection === "single" && path.at(-1) === parent.value) setPath(path.slice(0, -1))
    },
    reset,
    keyDown: (event: BaseUIEvent<KeyboardEvent<HTMLInputElement>>, options: { readonly escapes: boolean }) =>
      navigate(event, {
        browsing: typed === "",
        nested: nested && (event.key !== "Escape" || options.escapes),
        branch: view
          .flatMap((section) => section.items)
          .find((row) => row.kind === "option" && row.value === highlighted.current && row.option.options),
        tree,
      }),
  }
}

function useCreation(onCreate: Create | undefined, done: (created: string | void) => void) {
  const [state, setState] = useState<(Creation & { name: string }) | null>(null)
  return {
    state,
    clear: () => setState(null),
    commit: (name: string, row: string, step?: string) => {
      if (!onCreate) return
      setState({ state: "pending", name, row })
      void Promise.resolve(name)
        .then((value) => onCreate(value, step))
        .then(
          (created) => {
            setState(null)
            done(created)
          },
          (error: unknown) => setState({ state: "failed", name, row, message: failure(error, name) }),
        )
    },
  }
}

function failure(error: unknown, name: string) {
  if (error instanceof Error && error.message !== "") return error.message
  return `Couldn’t create “${name}”.`
}

function navigate(
  event: BaseUIEvent<KeyboardEvent<HTMLInputElement>>,
  context: { browsing: boolean; nested: boolean; branch: Row | undefined; tree: Tree },
) {
  if (!context.browsing) return
  const branch = event.key === "ArrowRight" ? context.branch : undefined
  const pops = context.nested && ["ArrowLeft", "Backspace", "Escape"].includes(event.key)
  if (!branch && !pops) return
  event.preventDefault()
  event.preventBaseUIHandler()
  if (branch) return context.tree.drill(branch.value)
  event.stopPropagation()
  context.tree.back()
}

export function useSelection(props: Selection, groups: readonly Group[]) {
  const [ownValues, setOwnValues] = useState(props.selection === "multiple" ? (props.defaultValue ?? []) : [])
  const [ownValue, setOwnValue] = useState(props.selection === "multiple" ? null : (props.defaultValue ?? null))
  const values = props.selection === "multiple" ? (props.value ?? ownValues) : []
  const changeValues = (next: readonly string[]) => {
    const settled = settle(groups, values, next)
    setOwnValues(settled)
    if (props.selection === "multiple") props.onValueChange?.(settled)
  }
  const changeValue = (next: string | null) => {
    setOwnValue(next)
    if (props.selection !== "multiple") props.onValueChange?.(next)
  }
  return {
    values,
    value: props.selection !== "multiple" && props.value !== undefined ? props.value : ownValue,
    changeValues,
    changeValue,
    add: (created: string) =>
      props.selection === "multiple" ? changeValues([...values, created]) : changeValue(created),
  }
}
