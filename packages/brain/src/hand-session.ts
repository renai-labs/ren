export * as HandSession from "./hand-session.js"

import { ExecutorApi } from "@ren/hand-api/executor-api"
import type { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/process"
import type { RpcClientError } from "effect/rpc"
import type { HandConnections } from "./hand-connections.js"
import { HandSpawner } from "./hand-session/spawner.js"

type Unreached = HandConnections.Unavailable | ExecutorApi.UnauthorizedError | RpcClientError.RpcClientError

export interface Files {
  readonly read: (
    path: string,
    range?: ExecutorApi.Range,
  ) => Effect.Effect<
    ExecutorApi.ReadResult,
    | ExecutorApi.FileNotFoundError
    | ExecutorApi.WrongKindError
    | ExecutorApi.FileTooLargeError
    | ExecutorApi.FileSystemError
    | Unreached
  >
  readonly write: (
    path: string,
    bytes: Uint8Array,
  ) => Effect.Effect<void, ExecutorApi.FileTooLargeError | ExecutorApi.FileSystemError | Unreached>
  readonly stat: (
    path: string,
  ) => Effect.Effect<ExecutorApi.FileInfo, ExecutorApi.FileNotFoundError | ExecutorApi.FileSystemError | Unreached>
  readonly list: (
    path: string,
  ) => Effect.Effect<
    ReadonlyArray<ExecutorApi.DirectoryEntry>,
    ExecutorApi.FileNotFoundError | ExecutorApi.WrongKindError | ExecutorApi.FileSystemError | Unreached
  >
  readonly remove: (path: string) => Effect.Effect<void, ExecutorApi.FileSystemError | Unreached>
  readonly move: (
    from: string,
    to: string,
  ) => Effect.Effect<void, ExecutorApi.FileNotFoundError | ExecutorApi.FileSystemError | Unreached>
  readonly mkdir: (path: string) => Effect.Effect<void, ExecutorApi.FileSystemError | Unreached>
}

export interface Interface {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly spawnerWith: (options: HandSpawner.SpawnOptions) => ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly files: Files
}

export const make = (
  connections: HandConnections.Interface,
  sessionId: Session.ID,
  killedBySignal: HandSpawner.KilledBySignal,
): Interface => {
  const withConnection = <A, E>(use: (connection: HandConnections.Connection) => Effect.Effect<A, E>) =>
    connections.connect(sessionId).pipe(Effect.flatMap(use), Effect.scoped)
  const sessionSpawner = (options: HandSpawner.SpawnOptions = {}) =>
    ChildProcessSpawner.make((command) =>
      connections.connect(sessionId).pipe(
        Effect.mapError(HandSpawner.childProcessError("spawn")),
        Effect.flatMap((connection) => HandSpawner.make(connection, killedBySignal, options).spawn(command)),
      ),
    )
  return {
    spawner: sessionSpawner(),
    spawnerWith: sessionSpawner,
    files: {
      read: Effect.fn("HandSession.read")((path: string, range?: ExecutorApi.Range) =>
        withConnection((connection) => connection.client["files.read"]({ path, ...(range && { range }) })),
      ),
      write: Effect.fn("HandSession.write")((path: string, bytes: Uint8Array) =>
        bytes.length > ExecutorApi.maxFileBytes
          ? Effect.fail(
              new ExecutorApi.FileTooLargeError({ path, sizeBytes: bytes.length, maxBytes: ExecutorApi.maxFileBytes }),
            )
          : withConnection((connection) => connection.client["files.write"]({ path, bytes })),
      ),
      stat: Effect.fn("HandSession.stat")((path: string) =>
        withConnection((connection) => connection.client["files.stat"]({ path })),
      ),
      list: Effect.fn("HandSession.list")((path: string) =>
        withConnection((connection) => connection.client["files.list"]({ path })),
      ),
      remove: Effect.fn("HandSession.remove")((path: string) =>
        withConnection((connection) => connection.client["files.remove"]({ path })),
      ),
      move: Effect.fn("HandSession.move")((from: string, to: string) =>
        withConnection((connection) => connection.client["files.move"]({ from, to })),
      ),
      mkdir: Effect.fn("HandSession.mkdir")((path: string) =>
        withConnection((connection) => connection.client["files.mkdir"]({ path })),
      ),
    },
  }
}
