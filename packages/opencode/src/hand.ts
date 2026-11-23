export * as Hand from "./hand.js"

import type { ChatAccess } from "@ren/chat/chat-access"
import { Session } from "@ren/schema/session"
import type { SessionCapabilities } from "@ren/schema/session/capabilities"
import { Shell } from "@ren/schema/shell"
import { Effect, Option, Schema, Struct } from "effect"
import { RenAuth } from "./auth.js"
import { Binding } from "./binding.js"
import { Link } from "./link.js"
import type { RenRpc } from "./rpc.js"

export const patchLimit = 64 * 1024

const changesLimit = 512 * 1024

export const fileLimit = 256 * 1024

const outputLimit = 64 * 1024

const searchLimit = 50

export class NotRen extends Schema.TaggedError<NotRen>()("Hand.NotRen", { message: Schema.String }) {}

class Refused extends Schema.TaggedError<Refused>()("Hand.Refused", { message: Schema.String }) {}

const reason = (error: { readonly _tag: string; readonly message: string }, fallback: string) =>
  error._tag === "ClientError" || !error.message ? fallback : error.message

const cut = (text: string, limit: number) => {
  if (text.length <= limit) return { text, truncated: false }
  const end = text.lastIndexOf("\n", limit)
  return { text: text.slice(0, end > 0 ? end + 1 : limit), truncated: true }
}

// oxlint-disable-next-line no-control-regex -- matches terminal escape sequences, as @ren/chat's TimelineText.shellOutput does
const ansi = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g

const shellInfo = (shell: Shell.Info): RenRpc.ShellInfo =>
  Struct.pick(shell, ["id", "sessionID", "command", "status", "exit"])

export const make = Effect.gen(function* () {
  const links = yield* Link.Service
  const bindings = yield* Binding.Service

  const reach = <A, E extends { readonly _tag: string; readonly message: string }>(
    sessionID: string,
    capability: keyof Pick<SessionCapabilities.Info, "files" | "shell">,
    body: (chat: ChatAccess.Client, sessionId: Session.ID) => Effect.Effect<A, E>,
  ) =>
    Effect.gen(function* () {
      const id = yield* Schema.decodeUnknownEffect(Session.ID)(sessionID).pipe(
        Effect.mapError(() => new NotRen({ message: "This is not a Ren session." })),
      )
      const bound = Option.filter(
        yield* bindings.get(id).pipe(Effect.mapError((error) => new Refused({ message: error.message }))),
        (info) => !info.sessionId || info.sessionId === id,
      )
      if (Option.isNone(bound)) return yield* new NotRen({ message: "This is not a Ren session." })
      if (!bound.value.sessionId)
        return yield* new Refused({ message: "This Ren session starts on Ren with its first prompt." })
      const link = yield* links.open(id)
      const chat = yield* link.client.pipe(
        Effect.timeoutOrElse({
          duration: "1 minute",
          orElse: () => Effect.fail(new Refused({ message: "Ren’s brain did not answer within a minute." })),
        }),
        Effect.mapError((error) => {
          if (error._tag === "Hand.Refused") return error
          if (error.cause instanceof RenAuth.SignedOut) return error.cause
          return new Refused({
            message: error.cause instanceof Error ? error.cause.message : "Ren could not reach the session’s brain.",
          })
        }),
      )
      const info = yield* chat.session
        .get({ sessionID: id })
        .pipe(Effect.mapError((error) => new Refused({ message: reason(error, "Ren’s brain did not answer.") })))
      if (!info.capabilities[capability])
        return yield* new Refused({
          message:
            capability === "files"
              ? "This Ren session cannot show the files of its hand."
              : "This Ren session cannot run commands on its hand.",
        })
      return yield* body(chat, id).pipe(
        Effect.mapError((error) => new Refused({ message: reason(error, "Ren’s brain did not answer.") })),
      )
    }).pipe(Effect.scoped)

  return {
    changes: (input: { readonly sessionID: string; readonly path?: string; readonly mode?: RenRpc.DiffMode }) =>
      reach(input.sessionID, "files", (chat, sessionID) =>
        Effect.gen(function* () {
          const projects = yield* chat.vcs.projects({ sessionID })
          const path = input.path ?? projects.at(0)?.path ?? ""
          const mode = input.mode ?? "working"
          const vcs = yield* chat.vcs.get({ sessionID, ...(path && { path }) })
          const files = vcs.provider ? yield* chat.vcs.diff({ sessionID, mode, context: 3, ...(path && { path }) }) : []
          const budget = { left: changesLimit }
          return {
            projects,
            path,
            mode,
            repository: Boolean(vcs.provider),
            branch: vcs.branch,
            files: files.map((file) => {
              const patch = cut(file.patch, Math.min(patchLimit, budget.left))
              budget.left -= patch.text.length
              return {
                file: file.file,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
                patch: patch.text,
                truncated: patch.truncated,
              }
            }),
          }
        }),
      ),
    listFiles: (input: { readonly sessionID: string; readonly path?: string }) =>
      reach(input.sessionID, "files", (chat, sessionID) =>
        chat.file.list({ sessionID, ...(input.path && { path: input.path }) }).pipe(
          Effect.map((page) => ({
            path: input.path ?? "",
            entries: page.entries.map((entry) => Struct.pick(entry, ["path", "type", "size"])),
          })),
        ),
      ),
    searchFiles: (input: { readonly sessionID: string; readonly query: string }) =>
      reach(input.sessionID, "files", (chat, sessionID) =>
        chat.file.search({ sessionID, query: input.query, limit: searchLimit }).pipe(
          Effect.map((entries) => ({
            entries: entries.map((entry) => Struct.pick(entry, ["path", "type", "size"])),
          })),
        ),
      ),
    readFile: (input: { readonly sessionID: string; readonly path: string }) =>
      reach(input.sessionID, "files", (chat, sessionID) =>
        chat.file.read({ sessionID, path: input.path }).pipe(
          Effect.map((file) => {
            const binary = file.encoding === "base64"
            const content = cut(binary ? "" : file.content, fileLimit)
            return {
              path: file.path,
              size: file.size,
              binary,
              content: content.text,
              truncated: file.truncated || content.truncated,
            }
          }),
        ),
      ),
    runShell: (input: { readonly sessionID: string; readonly command: string }) =>
      reach(input.sessionID, "shell", (chat, sessionID) =>
        chat.shell.create({ sessionID, command: input.command }).pipe(Effect.map(shellInfo)),
      ),
    listShells: (input: { readonly sessionID: string }) =>
      reach(input.sessionID, "shell", (chat, sessionID) =>
        chat.shell.list({ sessionID }).pipe(Effect.map((shells) => ({ shells: shells.map(shellInfo) }))),
      ),
    readShell: (input: { readonly sessionID: string; readonly shellID: string; readonly cursor: number }) =>
      reach(input.sessionID, "shell", (chat, sessionID) =>
        Effect.gen(function* () {
          const shellID = yield* Schema.decodeUnknownEffect(Shell.ID)(input.shellID)
          const shell = yield* chat.shell.get({ sessionID, shellID })
          const output = yield* chat.shell.output({ sessionID, shellID, cursor: input.cursor, limit: outputLimit })
          return {
            shell: shellInfo(shell),
            ...output,
            output: output.output.replaceAll(ansi, "").replaceAll(/\r\n?/g, "\n"),
          }
        }),
      ),
    stopShell: (input: { readonly sessionID: string; readonly shellID: string }) =>
      reach(input.sessionID, "shell", (chat, sessionID) =>
        Schema.decodeUnknownEffect(Shell.ID)(input.shellID).pipe(
          Effect.flatMap((shellID) => chat.shell.remove({ sessionID, shellID })),
          Effect.as({}),
        ),
      ),
  }
})
