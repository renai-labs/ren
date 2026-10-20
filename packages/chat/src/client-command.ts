export * as ClientCommand from "./client-command.js"

import type { SessionCatalog } from "@ren/schema/session/catalog"

export type ID = "model.choose" | "session.compact" | "session.undo" | "session.redo"

export interface Option {
  readonly id: string
  readonly trigger: string
  readonly arguments?: boolean
  readonly type: "builtin" | "custom"
}

export interface Command extends Option {
  readonly id: ID
  readonly description: string
  readonly type: "builtin"
}

export const builtins: ReadonlyArray<Command> = [
  { id: "model.choose", trigger: "model", description: "Choose model", type: "builtin" },
  { id: "session.compact", trigger: "compact", description: "Compact chat", type: "builtin" },
  { id: "session.undo", trigger: "undo", description: "Undo last message", type: "builtin" },
  { id: "session.redo", trigger: "redo", description: "Restore undone messages", type: "builtin" },
]

export const offered = (available: Readonly<Record<ID, boolean>>) => builtins.filter((item) => available[item.id])

export const parseSlashCommand = (text: string) => {
  if (!text.startsWith("/")) return
  const separator = text.search(/\s/)
  const name = text.slice(1, separator === -1 ? undefined : separator)
  return { name, input: separator === -1 ? "" : text.slice(separator).trim() }
}

export const parse = (options: ReadonlyArray<Option>, text: string) => {
  const command = parseSlashCommand(text)
  if (!command) return
  const option = options.find((item) => item.type === "builtin" && item.arguments && item.trigger === command.name)
  if (!option) return
  return { id: option.id, input: command.input }
}

export interface Suggestion {
  readonly value: string
  readonly trigger: string
  readonly description?: string | undefined
  readonly client?: ID
}

export const suggestions = (
  client: ReadonlyArray<Command>,
  brain: ReadonlyArray<SessionCatalog.Command>,
  query: string,
): ReadonlyArray<Suggestion> =>
  [
    ...brain.map((item) => ({ value: item.name, trigger: item.name, description: item.description })),
    ...client
      .filter((item) => !brain.some((command) => command.name === item.trigger))
      .map((item) => ({
        value: `client:${item.id}`,
        trigger: item.trigger,
        description: item.description,
        client: item.id,
      })),
  ].filter((item) => item.trigger.toLowerCase().includes(query.toLowerCase()))
