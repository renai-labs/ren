export * as EnvironmentCopies from "./copies.js"

import type { EnvironmentApi } from "@ren/environment-api/environment-api"
import type { Drive } from "@ren/schema/drive"
import type { Session } from "@ren/schema/session"
import { Skill } from "@ren/schema/skill"
import { Effect, Option, Schema } from "effect"
import type { EnvironmentConnections } from "./connections.js"

export interface File {
  readonly path: string
  readonly bytes: Uint8Array
}

// oxlint-disable-next-line ren/no-comments -- The environment downloads an archive itself, so its bytes never pass through the brain. The archive and inline forms fill a staging folder that moves into place, so a folder that exists is complete.
export type Copy =
  | { readonly type: "archive"; readonly unpack: Omit<EnvironmentApi.UnpackInput, "path"> }
  | { readonly type: "inline"; readonly files: ReadonlyArray<File> }
  | { readonly type: "mount"; readonly remote: Drive.Remote }

export interface Item {
  readonly path: string
  readonly copy: Copy
}

export interface Failure<I extends Item = Item> {
  readonly item: I
  readonly message: string
}

export interface Interface {
  // oxlint-disable-next-line ren/no-comments -- R5, R17, R38: copies each item that the current generation does not have, 4 at a time, and returns the items that failed. The next call tries them again.
  readonly ensure: <I extends Item>(items: ReadonlyArray<I>) => Effect.Effect<ReadonlyArray<Failure<I>>>
  // oxlint-disable-next-line ren/no-comments -- R44: the next call copies every item again; the executor answers at once for a folder that exists.
  readonly turnStarted: Effect.Effect<void>
}

const isInside = Schema.is(Skill.SourceDirectory)

const copyWith = (client: EnvironmentConnections.Connection["client"], item: Item) => {
  const copy = item.copy
  if (copy.type === "archive") return client["files.unpack"]({ ...copy.unpack, path: item.path })
  if (copy.type === "mount") return client["drives.mount"]({ path: item.path, remote: copy.remote })
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

// oxlint-disable-next-line ren/no-comments -- R53: the record of copies for references and skills. The generation and the copies come from one connection, so a copy never counts for another environment.
export const make = (connections: EnvironmentConnections.Interface, sessionId: Session.ID): Interface => {
  const copied = { generation: Number.NaN, paths: new Set<string>() }
  return {
    ensure: <I extends Item>(items: ReadonlyArray<I>) =>
      connections.connect(sessionId).pipe(
        Effect.flatMap((connection) => {
          if (connection.generation !== copied.generation) {
            copied.generation = connection.generation
            copied.paths.clear()
          }
          return Effect.forEach(
            items.filter((item) => !copied.paths.has(item.path)),
            (item) =>
              copyWith(connection.client, item).pipe(
                Effect.as(Option.none<Failure<I>>()),
                Effect.catch((error: { readonly message: string }) =>
                  Effect.succeed(Option.some({ item, message: error.message })),
                ),
                Effect.tap((failure) =>
                  Effect.sync(() => {
                    if (Option.isNone(failure) || item.copy.type === "mount") copied.paths.add(item.path)
                  }),
                ),
              ),
            { concurrency: 4 },
          )
        }),
        Effect.scoped,
        Effect.map((results) => results.filter(Option.isSome).map((result) => result.value)),
        Effect.catch((error) => Effect.succeed(items.map((item) => ({ item, message: error.message })))),
      ),
    turnStarted: Effect.sync(() => copied.paths.clear()),
  }
}
