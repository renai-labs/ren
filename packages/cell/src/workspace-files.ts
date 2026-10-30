export * as WorkspaceFiles from "./workspace-files.js"

import type { EnvironmentConnections } from "@ren/brain/environment/connections"
import type { Session } from "@ren/schema/session"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { dirname, resolve } from "node:path"

export class Failure extends Schema.TaggedError<Failure>()("WorkspaceFiles.Failure", {
  path: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly read: (path: string) => Effect.Effect<Uint8Array, Failure>
  readonly write: (path: string, bytes: Uint8Array) => Effect.Effect<void, Failure>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/WorkspaceFiles") {}

export const layerLocal = (directory: string) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return Service.of({
        read: Effect.fn("WorkspaceFiles.read")((path) =>
          fs
            .readFile(resolve(directory, path))
            .pipe(Effect.mapError((cause) => new Failure({ path, message: cause.message, cause }))),
        ),
        write: Effect.fn("WorkspaceFiles.write")(
          function* (path, bytes) {
            const file = resolve(directory, path)
            yield* fs.makeDirectory(dirname(file), { recursive: true })
            yield* fs.writeFile(file, bytes)
          },
          (effect, path) =>
            effect.pipe(Effect.mapError((cause) => new Failure({ path, message: cause.message, cause }))),
        ),
      })
    }),
  )

export const layerEnvironment = (connections: EnvironmentConnections.Interface, sessionId: Session.ID) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const connection = yield* connections.connect(sessionId)
      return Service.of({
        read: Effect.fn("WorkspaceFiles.read")((path) =>
          connection.client["files.read"]({ path }).pipe(
            Effect.map((result) => result.bytes),
            Effect.mapError((cause) => new Failure({ path, message: String(cause), cause })),
          ),
        ),
        write: Effect.fn("WorkspaceFiles.write")((path, bytes) =>
          connection.client["files.write"]({ path, bytes }).pipe(
            Effect.asVoid,
            Effect.mapError((cause) => new Failure({ path, message: String(cause), cause })),
          ),
        ),
      })
    }),
  )
