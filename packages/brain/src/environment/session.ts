export * as EnvironmentSession from "./session.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import type { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/process"
import type { RpcClientError } from "effect/rpc"
import type { EnvironmentConnections } from "./connections.js"
import { EnvironmentSpawner } from "./session/spawner.js"

type Unreached = EnvironmentConnections.Unavailable | EnvironmentApi.UnauthorizedError | RpcClientError.RpcClientError

export interface Files {
  readonly read: (
    path: string,
    range?: EnvironmentApi.Range,
  ) => Effect.Effect<
    EnvironmentApi.ReadResult,
    | EnvironmentApi.FileNotFoundError
    | EnvironmentApi.WrongKindError
    | EnvironmentApi.FileTooLargeError
    | EnvironmentApi.FileSystemError
    | Unreached
  >
  readonly write: (
    path: string,
    bytes: Uint8Array,
  ) => Effect.Effect<void, EnvironmentApi.FileTooLargeError | EnvironmentApi.FileSystemError | Unreached>
  readonly stat: (
    path: string,
  ) => Effect.Effect<
    EnvironmentApi.FileInfo,
    EnvironmentApi.FileNotFoundError | EnvironmentApi.FileSystemError | Unreached
  >
  readonly list: (
    path: string,
  ) => Effect.Effect<
    ReadonlyArray<EnvironmentApi.DirectoryEntry>,
    EnvironmentApi.FileNotFoundError | EnvironmentApi.WrongKindError | EnvironmentApi.FileSystemError | Unreached
  >
  readonly remove: (path: string) => Effect.Effect<void, EnvironmentApi.FileSystemError | Unreached>
  readonly move: (
    from: string,
    to: string,
  ) => Effect.Effect<void, EnvironmentApi.FileNotFoundError | EnvironmentApi.FileSystemError | Unreached>
  readonly mkdir: (path: string) => Effect.Effect<void, EnvironmentApi.FileSystemError | Unreached>
}

export interface Interface {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly spawnerWith: (options: EnvironmentSpawner.SpawnOptions) => ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly files: Files
}

export const make = (
  connections: EnvironmentConnections.Interface,
  sessionId: Session.ID,
  killedBySignal: EnvironmentSpawner.KilledBySignal,
): Interface => {
  const withConnection = <A, E>(use: (connection: EnvironmentConnections.Connection) => Effect.Effect<A, E>) =>
    connections.connect(sessionId).pipe(Effect.flatMap(use), Effect.scoped)
  const sessionSpawner = (options: EnvironmentSpawner.SpawnOptions = {}) =>
    ChildProcessSpawner.make((command) =>
      Effect.all({
        connection: connections.connect(sessionId),
        variables: connections.variables ?? Effect.succeed({}),
      }).pipe(
        Effect.mapError(EnvironmentSpawner.childProcessError("spawn")),
        Effect.flatMap((found) =>
          EnvironmentSpawner.make(found.connection, killedBySignal, { ...options, variables: found.variables }).spawn(
            command,
          ),
        ),
      ),
    )
  return {
    spawner: sessionSpawner(),
    spawnerWith: sessionSpawner,
    files: {
      read: Effect.fn("EnvironmentSession.read")((path: string, range?: EnvironmentApi.Range) =>
        withConnection((connection) => connection.client["files.read"]({ path, ...(range && { range }) })),
      ),
      write: Effect.fn("EnvironmentSession.write")((path: string, bytes: Uint8Array) =>
        bytes.length > EnvironmentApi.maxFileBytes
          ? Effect.fail(
              new EnvironmentApi.FileTooLargeError({
                path,
                sizeBytes: bytes.length,
                maxBytes: EnvironmentApi.maxFileBytes,
              }),
            )
          : withConnection((connection) => connection.client["files.write"]({ path, bytes })),
      ),
      stat: Effect.fn("EnvironmentSession.stat")((path: string) =>
        withConnection((connection) => connection.client["files.stat"]({ path })),
      ),
      list: Effect.fn("EnvironmentSession.list")((path: string) =>
        withConnection((connection) => connection.client["files.list"]({ path })),
      ),
      remove: Effect.fn("EnvironmentSession.remove")((path: string) =>
        withConnection((connection) => connection.client["files.remove"]({ path })),
      ),
      move: Effect.fn("EnvironmentSession.move")((from: string, to: string) =>
        withConnection((connection) => connection.client["files.move"]({ from, to })),
      ),
      mkdir: Effect.fn("EnvironmentSession.mkdir")((path: string) =>
        withConnection((connection) => connection.client["files.mkdir"]({ path })),
      ),
    },
  }
}
