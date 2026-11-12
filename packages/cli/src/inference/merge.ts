export * as Merge from "./merge.js"

import type { RenInference } from "@ren/schema/ren-inference"
import { applyEdits, modify, type FormattingOptions } from "jsonc-parser/lib/esm/main.js"
import { Option, type Schema } from "effect"
import { isMap, isSeq, parseDocument, stringify, YAMLSeq } from "yaml"

export type Json = typeof Schema.Json.Type

export type Format = "json" | "jsonc" | "toml" | "yaml" | "dotenv"

export type Scalar = string | number | boolean

export class MergeError extends Error {
  override name = "MergeError"
}

const jsonFormat: FormattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" }

const isScalar = (value: Json): value is Scalar =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"

export const setJson = (existing: string, keyPath: ReadonlyArray<string>, value: Json | undefined) => {
  const text = existing.trim() === "" ? "{}\n" : existing
  return applyEdits(text, modify(text, [...keyPath], value, { formattingOptions: jsonFormat }))
}

const yamlDocument = (text: string) => {
  const empty = text.trim() === ""
  const document = parseDocument(empty ? "{}" : text)
  const problem = document.errors.at(0)
  if (problem) throw new MergeError(`could not parse YAML: ${problem.message}`)
  if (empty && isMap(document.contents)) document.contents.flow = false
  return document
}

export const setYaml = (existing: string, keyPath: ReadonlyArray<string>, value: Json) => {
  const document = yamlDocument(existing)
  document.setIn(keyPath, document.createNode(value))
  return document.toString()
}

export const removeYaml = (existing: string, keyPath: ReadonlyArray<string>) => {
  const document = yamlDocument(existing)
  document.deleteIn(keyPath)
  return document.toString()
}

export const appendYamlItem = (
  existing: string,
  listKey: string,
  identity: { readonly key: string; readonly value: string },
  item: Json,
) => {
  const document = yamlDocument(existing)
  const current = document.get(listKey, true)
  const list = isSeq(current) ? current : new YAMLSeq()
  const index = list.items.findIndex((entry) => isMap(entry) && entry.get(identity.key) === identity.value)
  const created = document.createNode(item)
  if (index === -1) list.items.push(created)
  else list.items[index] = created
  if (!isSeq(current)) document.set(listKey, list)
  return document.toString()
}

interface TomlBlock {
  readonly name: string | null
  readonly array: boolean
  readonly lines: Array<string>
}

const tomlHeader = /^\s*(\[\[?)\s*([^[\]]+?)\s*(\]\]?)\s*$/u

// oxlint-disable-next-line ren/no-comments -- Blank and comment lines right before a header belong to the table they introduce, so removing a table keeps the next one's comment.
export const tomlBlocks = (text: string) => {
  const blocks: Array<TomlBlock> = []
  let current: TomlBlock = { name: null, array: false, lines: [] }
  let significant = 0
  for (const line of text.split("\n")) {
    const header = tomlHeader.exec(line)
    const open = header?.at(1)
    if (header && open?.length === header.at(3)?.length) {
      const carried = current.lines.splice(significant)
      blocks.push(current)
      current = { name: header.at(2) ?? null, array: open === "[[", lines: [...carried, line] }
      significant = current.lines.length
    } else {
      current.lines.push(line)
      if (line.trim() !== "" && !line.trimStart().startsWith("#")) significant = current.lines.length
    }
  }
  return [...blocks, current]
}

const tomlValue = (value: Scalar) => (typeof value === "string" ? JSON.stringify(value) : String(value))

const tomlTable = (name: string | null, entries: Readonly<Record<string, Scalar>>) =>
  [
    ...(name ? [`[${name}]`] : []),
    ...Object.entries(entries).map(([key, value]) => `${key} = ${tomlValue(value)}`),
  ].join("\n")

// oxlint-disable-next-line ren/no-comments -- A table Ren owns is one block, so it is removed and appended whole rather than parsed.
export const upsertTomlTable = (existing: string, name: string, entries: Readonly<Record<string, Scalar>>) => {
  const body = tomlBlocks(existing)
    .filter((block) => block.array || block.name !== name)
    .flatMap((block) => block.lines)
    .join("\n")
    .replace(/\n+$/u, "")
  const table = tomlTable(name, entries)
  return body === "" ? `${table}\n` : `${body}\n\n${table}\n`
}

export const renderToml = (value: Readonly<Record<string, Json>>) => {
  const top = Object.entries(value).flatMap(([key, each]) => (isScalar(each) ? [[key, each] as const] : []))
  const tables = Object.entries(value).flatMap(([name, table]) => {
    if (isScalar(table)) return []
    if (!table || Array.isArray(table)) throw new MergeError(`${name} cannot be written as TOML`)
    const scalars = Object.entries(table).map(([key, nested]) => {
      if (!isScalar(nested)) throw new MergeError(`${name}.${key} cannot be written as TOML`)
      return [key, nested] as const
    })
    return [tomlTable(name, Object.fromEntries(scalars))]
  })
  return `${[...(top.length > 0 ? [tomlTable(null, Object.fromEntries(top))] : []), ...tables].join("\n\n")}\n`
}

// oxlint-disable-next-line ren/no-comments -- Line by line on purpose: rewriting a dotenv file from a parsed map drops the comments people keep in it.
export const setDotenv = (existing: string, incoming: Readonly<Record<string, string>>) => {
  const lines = existing === "" ? [] : existing.replace(/\n$/u, "").split("\n")
  const name = (line: string) => /^([A-Za-z_][A-Za-z0-9_]*)=/u.exec(line)?.at(1)
  const names = new Set(lines.map(name))
  const merged = lines.map((line) => {
    const found = name(line)
    return found && Object.hasOwn(incoming, found) ? `${found}=${incoming[found]}` : line
  })
  const added = Object.entries(incoming)
    .filter(([key]) => !names.has(key))
    .map(([key, value]) => `${key}=${value}`)
  return `${[...merged, ...added].join("\n")}\n`
}

const ownedFile = (format: "json" | "jsonc" | "toml" | "yaml", value: Readonly<Record<string, Json>>) => {
  if (format === "toml") return renderToml(value)
  if (format === "yaml") return stringify(value)
  return `${JSON.stringify(value, null, 2)}\n`
}

const objectEdit = (format: Format, existing: string, keyPath: ReadonlyArray<string>, value: Option.Option<Json>) => {
  if (format === "json" || format === "jsonc") return setJson(existing, keyPath, Option.getOrUndefined(value))
  if (format !== "yaml") throw new MergeError(`a ${format} file cannot be edited by key path`)
  return Option.match(value, {
    onNone: () => removeYaml(existing, keyPath),
    onSome: (found) => setYaml(existing, keyPath, found),
  })
}

// oxlint-disable-next-line ren/no-comments -- One edit of a plan on the text of its file. Each edit is the narrowest change, so a person's comments and key order stay. Null removes the file.
export const apply = (existing: string, operation: RenInference.HarnessOperation, format: Format): string | null => {
  switch (operation.kind) {
    case "set-object-path":
      return objectEdit(format, existing, operation.keyPath, Option.some(operation.value))
    case "remove-object-path":
      return objectEdit(format, existing, operation.keyPath, Option.none())
    case "upsert-yaml-mapping":
      return setYaml(existing, operation.keyPath, operation.value)
    case "upsert-toml-table":
      if (!operation.tableName) throw new MergeError("a TOML edit needs a table name")
      return upsertTomlTable(existing, operation.tableName, operation.entries)
    case "append-unique-list-item":
      return appendYamlItem(existing, operation.listKey, operation.identity, operation.item)
    case "replace-ren-owned-file":
      return ownedFile(operation.format, operation.value)
    case "remove-ren-owned-file":
      return null
    case "set-environment-variables":
      return setDotenv(existing, operation.entries)
  }
}
