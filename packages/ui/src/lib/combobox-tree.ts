import type { ReactNode } from "react"

export type Option = {
  value: string
  label: string
  description?: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  keywords?: readonly string[]
  options?: readonly Option[]
  selection?: "single" | "multiple"
}

export type Group = {
  value: string
  label?: ReactNode
  items: readonly Option[]
}

export type CreateStep = {
  label: string
  options: readonly Option[]
}

export type Row =
  | { kind: "option"; value: string; label: string; option: Option; ancestors: readonly string[] }
  | { kind: "back"; value: string; label: string }
  | { kind: "create"; value: string; label: string }
  | { kind: "step"; value: string; label: string; option: Option }

export type Section = {
  value: string
  label?: ReactNode
  items: readonly Row[]
}

export type Creation = ({ state: "pending" } | { state: "failed"; message: string }) & { row: string }

export type Tree = {
  creation: Creation | null
  drill: (value: string) => void
  back: () => void
  create: (row: Row) => void
}

type Leaf = { option: Option; ancestors: readonly Option[] }

const back = "ren-combobox:back"
const create = "ren-combobox:create"
const step = "ren-combobox:step:"

function leaves(options: readonly Option[], ancestors: readonly Option[] = []): Leaf[] {
  return options.flatMap((option) =>
    option.options ? leaves(option.options, [...ancestors, option]) : [{ option, ancestors }],
  )
}

function optionRow(option: Option, ancestors: readonly Option[]): Row {
  return {
    kind: "option",
    value: option.value,
    label: option.label,
    option,
    ancestors: ancestors.map((ancestor) => ancestor.label),
  }
}

function branchAt(groups: readonly Group[], path: readonly string[]) {
  return path.reduce<Option | undefined>(
    (branch, value) =>
      (branch ? branch.options : groups.flatMap((group) => group.items))?.find((option) => option.value === value),
    undefined,
  )
}

export function parentOf(groups: readonly Group[], value: string) {
  return groups
    .flatMap((group) => leaves(group.items))
    .find((leaf) => leaf.option.value === value)
    ?.ancestors.at(-1)
}

export function sections(input: {
  groups: readonly Group[]
  path: readonly string[]
  query: string
  draft: string | null
  createStep?: CreateStep
  createLabel?: (query: string) => string
}): Section[] {
  const query = input.query.trim()
  if (input.draft !== null && input.createStep && input.createLabel)
    return [
      { value: back, items: [{ kind: "back", value: back, label: input.createLabel(input.draft) }] },
      {
        value: step,
        label: input.createStep.label,
        items: input.createStep.options.map((option) => ({
          kind: "step",
          value: `${step}${option.value}`,
          label: option.label,
          option,
        })),
      },
    ]
  if (query !== "") {
    const found = input.groups.map((group) => ({
      value: group.value,
      label: group.label,
      items: leaves(group.items).map((leaf) => optionRow(leaf.option, leaf.ancestors)),
    }))
    const exact = found.some((group) =>
      group.items.some((row) => row.label.trim().toLocaleLowerCase() === query.toLocaleLowerCase()),
    )
    if (exact || !input.createLabel) return found
    return [...found, { value: create, items: [{ kind: "create", value: create, label: input.createLabel(query) }] }]
  }
  const branch = branchAt(input.groups, input.path)
  if (branch)
    return [
      {
        value: back,
        items: [
          { kind: "back", value: back, label: branch.label },
          ...(branch.options ?? []).map((option) => optionRow(option, [])),
        ],
      },
    ]
  return input.groups.map((group) => ({
    value: group.value,
    label: group.label,
    items: group.items.map((option) => optionRow(option, [])),
  }))
}

export function settle(groups: readonly Group[], previous: readonly string[], next: readonly string[]) {
  const added = next.find((value) => !previous.includes(value))
  const removed = previous.find((value) => !next.includes(value))
  if (added !== undefined) {
    const parent = parentOf(groups, added)
    if (parent?.selection !== "single") return [...next]
    const siblings = new Set(leaves(parent.options ?? []).map((leaf) => leaf.option.value))
    return next.filter((value) => value === added || !siblings.has(value))
  }
  if (removed !== undefined && parentOf(groups, removed)?.selection === "single") return [...previous]
  return [...next]
}

export function matches(row: Row, contains: (text: string) => boolean) {
  if (row.kind === "back" || row.kind === "create") return true
  if (row.kind === "step") return contains(row.label)
  return [row.label, ...(row.option.keywords ?? []), ...row.ancestors].some(contains)
}
