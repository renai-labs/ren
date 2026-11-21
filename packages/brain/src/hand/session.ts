export * as HandSession from "./session.js"

import { HandApi } from "@ren/hand-api/hand-api"
import type { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/process"
import type { RpcClientError } from "effect/rpc"
import type { HandConnections } from "./connections.js"
import { HandSpawner } from "./session/spawner.js"

type Unreached = HandConnections.Unavailable | HandApi.UnauthorizedError | RpcClientError.RpcClientError

export interface Files {
  readonly read: (
    path: string,
    range?: HandApi.Range,
  ) => Effect.Effect<
    HandApi.ReadResult,
    HandApi.FileNotFoundError | HandApi.WrongKindError | HandApi.FileTooLargeError | HandApi.FileSystemError | Unreached
  >
  readonly write: (
    path: string,
    bytes: Uint8Array,
  ) => Effect.Effect<void, HandApi.FileTooLargeError | HandApi.FileSystemError | Unreached>
  readonly stat: (
    path: string,
  ) => Effect.Effect<HandApi.FileInfo, HandApi.FileNotFoundError | HandApi.FileSystemError | Unreached>
  readonly list: (
    path: string,
  ) => Effect.Effect<
    ReadonlyArray<HandApi.DirectoryEntry>,
    HandApi.FileNotFoundError | HandApi.WrongKindError | HandApi.FileSystemError | Unreached
  >
  readonly remove: (path: string) => Effect.Effect<void, HandApi.FileSystemError | Unreached>
  readonly move: (
    from: string,
    to: string,
  ) => Effect.Effect<void, HandApi.FileNotFoundError | HandApi.FileSystemError | Unreached>
  readonly mkdir: (path: string) => Effect.Effect<void, HandApi.FileSystemError | Unreached>
  readonly unpack: (
    input: HandApi.UnpackInput,
  ) => Effect.Effect<void, HandApi.ArchiveError | HandApi.FileSystemError | Unreached>
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
      Effect.all({
        connection: connections.connect(sessionId),
        env: connections.env ?? Effect.succeed({ variables: {}, placeholders: {} }),
      }).pipe(
        Effect.mapError(HandSpawner.childProcessError("spawn")),
        Effect.flatMap((found) =>
          HandSpawner.make(found.connection, killedBySignal, {
            ...options,
            variables: { ...found.env.variables, ...(found.connection.egress && found.env.placeholders) },
          }).spawn(command),
        ),
      ),
    )
  return {
    spawner: sessionSpawner(),
    spawnerWith: sessionSpawner,
    files: {
      read: Effect.fn("HandSession.read")((path: string, range?: HandApi.Range) =>
        withConnection((connection) => connection.client["files.read"]({ path, ...(range && { range }) })),
      ),
      write: Effect.fn("HandSession.write")((path: string, bytes: Uint8Array) =>
        bytes.length > HandApi.maxFileBytes
          ? Effect.fail(
              new HandApi.FileTooLargeError({
                path,
                sizeBytes: bytes.length,
                maxBytes: HandApi.maxFileBytes,
              }),
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
      unpack: Effect.fn("HandSession.unpack")((input: HandApi.UnpackInput) =>
        withConnection((connection) => connection.client["files.unpack"](input)),
      ),
    },
  }
}
