export * as OpenCodeUnshownFiles from "./unshown-files.js"

import type { SessionMessage } from "@opencode/schema/session-message"
import { FileMention } from "@ren/schema/file-mention"
import { SessionMessage as RenMessage } from "@ren/schema/session/message"
import { DateTime, Option, Predicate } from "effect"
import { basename, extname, resolve } from "node:path"

export const marker = "ren.unshown-files"

const pages = new Set([".html", ".htm"])

const deliverables = new Set([
  ...pages,
  ".pdf",
  ".csv",
  ".tsv",
  ".xlsx",
  ".xls",
  ".ods",
  ".docx",
  ".doc",
  ".odt",
  ".rtf",
  ".pptx",
  ".ppt",
  ".odp",
  ".key",
  ".md",
  ".txt",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".mp4",
  ".mov",
  ".webm",
  ".mp3",
  ".wav",
  ".m4a",
  ".zip",
])

const maxFiles = 10

const pathOf = (input: unknown) =>
  Predicate.isObject(input) && "path" in input && typeof input.path === "string" ? input.path : undefined

const withoutSuffix = (name: string) => name.replace(/(?:#L\d+(?:-L?\d+)?|:\d+(?:-\d+)?)$/u, "")

// oxlint-disable-next-line ren/no-comments -- The files the agent made or named in its last answer this turn and did not show: every HTML page it wrote, and every deliverable its answer names. The caller keeps the ones that exist and changed since the turn started. Undefined once Ren has already asked in this turn.
export const of = (messages: ReadonlyArray<SessionMessage.Info>, folder: string) => {
  const start = messages.findLastIndex((message) => message.type === "user")
  const user = messages[start]
  if (user?.type !== "user") return undefined
  const turn = messages.slice(start + 1)
  if (turn.some((message) => message.type === "synthetic" && message.metadata?.[marker] !== undefined)) return undefined
  const tools = turn.flatMap((message) =>
    message.type === "assistant"
      ? message.content.flatMap((part) => (part.type === "tool" && part.state.status === "completed" ? [part] : []))
      : [],
  )
  const shown = new Set(
    tools.flatMap((part) => {
      const path = part.name === RenMessage.showFileTool ? pathOf(part.state.input) : undefined
      return path ? [basename(path)] : []
    }),
  )
  const written = tools.flatMap((part) => {
    const path = part.name === "write" ? pathOf(part.state.input) : undefined
    return path && pages.has(extname(path).toLowerCase()) ? [resolve(folder, path)] : []
  })
  const answer = Option.fromUndefinedOr(turn.findLast((message) => message.type === "assistant")).pipe(
    Option.map((message) =>
      message.type === "assistant"
        ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
        : "",
    ),
    Option.getOrElse(() => ""),
  )
  const named = FileMention.names(answer)
    .map(withoutSuffix)
    .filter((name) => deliverables.has(extname(name).toLowerCase()))
    .map((name) => resolve(folder, name))
  const paths = [...new Set([...written, ...named])].filter((path) => !shown.has(basename(path))).slice(0, maxFiles)
  return { since: DateTime.toEpochMillis(user.time.created), paths }
}

export const prompt = (paths: ReadonlyArray<string>, folder: string) =>
  [
    `Before you finish: you made or changed these files for the person in this turn and did not show them: ${paths
      .map((path) => `\`${path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path}\``)
      .join(", ")}.`,
    "Call show_file for each one now; an HTML page must always be shown. Skip a file that is only part of code changes in a project.",
    "Then stop. Do not write your answer again.",
  ].join(" ")
