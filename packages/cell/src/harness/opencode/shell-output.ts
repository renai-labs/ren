export * as ShellOutput from "./shell-output.js"

import { maxFileBytes } from "@ren/brain-api/executor-api"
import type { Environments } from "@ren/brain/environments"
import { Session } from "@ren/schema/session"
import { Effect, Option, Predicate, Schema } from "effect"
import { open, stat, unlink } from "node:fs/promises"
import { dirname } from "node:path"
import { RenWorkspaceDriver } from "./ren-workspace-driver.js"

// oxlint-disable-next-line ren/no-comments -- OpenCode keeps a long command's full output on the cell at `.../shell/<project>/sh_<id>.out` and names it to the model; file calls go to the sandbox, so Ren copies the file to the same path there.
const outputPath = /\/[^\s"'\\<>[\]]*\/shell\/[0-9a-f]+\/sh_[0-9A-Za-z]+\.out/g

const finishedJob = /<shell id="[^"]+" state="(?!running")[^"]*"[^>]*>[\s\S]*?<\/shell>/g

const texts = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(texts)
  if (Predicate.isObject(value)) return Object.values(value).flatMap(texts)
  return []
}

const paths = (text: string) => [...new Set(text.match(outputPath) ?? [])]

const finishedPaths = (text: string) => new Set((text.match(finishedJob) ?? []).flatMap(paths))

const tail = (path: string, size: number) =>
  Effect.promise(async () => {
    const length = Math.min(size, maxFileBytes)
    const file = await open(path, "r")
    const bytes = new Uint8Array(length)
    await file.read(bytes, 0, length, size - length)
    await file.close()
    return bytes
  })

export interface Sessions {
  readonly parentOf: (sessionId: string) => Effect.Effect<Option.Option<string>>
}

export const make = (environments: Environments.Interface, sessions: Sessions) => {
  const copied = new Map<string, number>()
  const rootOf = (sessionId: string): Effect.Effect<string> =>
    sessions
      .parentOf(sessionId)
      .pipe(
        Effect.flatMap(Option.match({ onNone: () => Effect.succeed(sessionId), onSome: (parent) => rootOf(parent) })),
      )
  const copy = Effect.fn("ShellOutput.copy")(function* (sessionId: string, path: string, isFinal: boolean) {
    const size = yield* Effect.promise(() =>
      stat(path).then(
        (info) => Option.some(info.size),
        () => Option.none(),
      ),
    )
    if (Option.isNone(size)) return
    if (copied.get(path) === size.value && !isFinal) return
    const root = yield* Schema.decodeUnknownEffect(Session.ID)(yield* rootOf(sessionId))
    const files = RenWorkspaceDriver.session(environments, root).overrides
    const bytes = yield* tail(path, size.value)
    if (copied.get(path) !== size.value) {
      yield* files.mkdir(dirname(path))
      yield* files.write(path, bytes)
      copied.set(path, size.value)
    }
    if (!isFinal) return
    copied.delete(path)
    yield* Effect.promise(() => unlink(path).catch(() => undefined))
    // oxlint-disable-next-line ren/no-comments -- A cell that shares its disk with the sandbox (celld, local development) has just deleted the copy too.
    yield* files.stat(path).pipe(
      Effect.catchTag("Environment.NotFound", () => files.write(path, bytes)),
      Effect.asVoid,
    )
  })
  const copyAll = (sessionId: string, text: string, isFinal: (path: string) => boolean) =>
    Effect.forEach(
      paths(text),
      (path) =>
        copy(sessionId, path, isFinal(path)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`Could not copy the shell output ${path} to the sandbox`, cause),
          ),
        ),
      { discard: true },
    )
  return {
    afterCommand: (sessionId: string, result: unknown, isRunning: boolean) =>
      copyAll(sessionId, texts(result).join("\n"), () => !isRunning),
    beforeRequest: (sessionId: string, messages: unknown) => {
      const text = texts(messages).join("\n")
      const finished = finishedPaths(text)
      return copyAll(sessionId, text, (path) => finished.has(path))
    },
  }
}
