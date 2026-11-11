export * as HandCopies from "./copies.js"

import type { HandApi } from "@ren/hand-api/hand-api"
import type { Drive } from "@ren/schema/drive"
import type { Session } from "@ren/schema/session"
import { Skill } from "@ren/schema/skill"
import { Effect, Option, Schema, Semaphore } from "effect"
import type { HandConnections } from "./connections.js"

export interface File {
  readonly path: string
  readonly bytes: Uint8Array
}

// oxlint-disable-next-line ren/no-comments -- The environment downloads an archive itself, so its bytes never pass through the brain. The archive and inline forms fill a staging folder that moves into place, so a folder that exists is complete.
export type Copy =
  | { readonly type: "archive"; readonly unpack: Omit<HandApi.UnpackInput, "path"> }
  | { readonly type: "inline"; readonly files: ReadonlyArray<File> }
  | { readonly type: "mount"; readonly remote: Drive.Remote; readonly access: Drive.Access }

export interface Item {
  readonly path: string
  readonly copy: Copy
}

export interface Failure<I extends Item = Item> {
  readonly item: I
  readonly message: string
}

export interface Interface {
  // oxlint-disable-next-line ren/no-comments -- Failed mounts retain their explanation until the next turn or destination; other failed copies can retry immediately.
  readonly ensure: <I extends Item>(items: ReadonlyArray<I>) => Effect.Effect<ReadonlyArray<Failure<I>>>
  // oxlint-disable-next-line ren/no-comments -- R44: the next call copies every item again; the executor answers at once for a folder that exists.
  readonly turnStarted: Effect.Effect<void>
}

const isInside = Schema.is(Skill.SourceDirectory)

const copyWith = (connection: HandConnections.Connection, item: Item) => {
  const client = connection.client
  const copy = item.copy
  if (copy.type === "archive") return client["files.unpack"]({ ...copy.unpack, path: item.path })
  if (copy.type === "mount")
    return connection.hello.mount
      ? client["drives.mount"]({ path: item.path, remote: copy.remote, access: copy.access })
      : Effect.fail({ message: "its environment has no rclone or no usable /dev/fuse" })
  return Effect.gen(function* () {
    const exists = yield* client["files.stat"]({ path: item.path }).pipe(
      Effect.as(true),
      Effect.catchTag("FileNotFoundError", () => Effect.succeed(false)),
    )
    if (exists) return
    const staging = `${item.path}.${crypto.randomUUID()}.staging`
    yield* Effect.forEach(
      copy.files,
      (file) =>
        isInside(file.path) && file.path !== "."
          ? client["files.write"]({ path: `${staging}/${file.path}`, bytes: file.bytes })
          : Effect.fail({ message: `${file.path} is not a path inside it` }),
      { discard: true },
    ).pipe(
      Effect.andThen(client["files.move"]({ from: staging, to: item.path })),
      Effect.onError(() => client["files.remove"]({ path: staging }).pipe(Effect.ignore)),
    )
  })
}

// oxlint-disable-next-line ren/no-comments -- Destination identity and generation come from one connection. Serialize callers so a failed mount is attempted only once per turn.
export const make = (connections: HandConnections.Interface, sessionId: Session.ID): Interface => {
  const lock = Semaphore.makeUnsafe(1)
  const copied = { destination: "", generation: Number.NaN, paths: new Map<string, Option.Option<string>>() }
  return {
    ensure: <I extends Item>(items: ReadonlyArray<I>) =>
      connections.connect(sessionId).pipe(
        Effect.flatMap((connection) => {
          if (connection.hello.environmentId !== copied.destination || connection.generation !== copied.generation) {
            copied.destination = connection.hello.environmentId
            copied.generation = connection.generation
            copied.paths.clear()
          }
          return Effect.forEach(
            items,
            (item) => {
              const cached = copied.paths.get(item.path)
              if (cached) return Effect.succeed(Option.map(cached, (message) => ({ item, message })))
              return copyWith(connection, item).pipe(
                Effect.as(Option.none<Failure<I>>()),
                Effect.catch((error: { readonly message: string }) =>
                  Effect.succeed(Option.some({ item, message: error.message })),
                ),
                Effect.tap((failure) =>
                  Effect.sync(() => {
                    if (Option.isNone(failure) || item.copy.type === "mount")
                      copied.paths.set(
                        item.path,
                        Option.map(failure, (failed) => failed.message),
                      )
                  }),
                ),
              )
            },
            { concurrency: 4 },
          )
        }),
        Effect.scoped,
        Effect.map((results) => results.filter(Option.isSome).map((result) => result.value)),
        Effect.catch((error) => Effect.succeed(items.map((item) => ({ item, message: error.message })))),
        lock.withPermits(1),
      ),
    turnStarted: Effect.sync(() => copied.paths.clear()).pipe(lock.withPermits(1)),
  }
}
