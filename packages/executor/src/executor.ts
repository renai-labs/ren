export * as Executor from "./executor.js"

import type { ExecutorApi } from "@ren/hand-api/executor-api"
import type { Signal } from "@ren/hand-api/signal"
import type { Brain } from "@ren/schema/brain"
import { Context, type Effect, type Stream } from "effect"

export interface Interface {
  readonly hello: ExecutorApi.Hello
  readonly spawn: (
    brain: Brain.ID,
    input: ExecutorApi.SpawnInput,
  ) => Effect.Effect<ExecutorApi.SpawnResult, ExecutorApi.SpawnFailedError>
  readonly output: (
    brain: Brain.ID,
    id: ExecutorApi.ProcessID,
    cursor?: number,
    window?: ExecutorApi.OutputWindow,
  ) => Effect.Effect<Stream.Stream<ExecutorApi.ProcessEvent>, ExecutorApi.ProcessNotFoundError>
  readonly writeStdin: (
    brain: Brain.ID,
    id: ExecutorApi.ProcessID,
    input: { readonly data: Uint8Array; readonly end: boolean },
  ) => Effect.Effect<void, ExecutorApi.ProcessNotFoundError | ExecutorApi.StdinFullError | ExecutorApi.StdinClosedError>
  readonly heartbeat: (
    brain: Brain.ID,
    id: ExecutorApi.ProcessID,
  ) => Effect.Effect<void, ExecutorApi.ProcessNotFoundError>
  readonly kill: (
    brain: Brain.ID,
    id: ExecutorApi.ProcessID,
    signal: Signal.Name,
    forceKillAfterMs?: number,
  ) => Effect.Effect<void, ExecutorApi.ProcessNotFoundError>
  readonly read: (
    path: string,
    range?: ExecutorApi.Range,
  ) => Effect.Effect<
    ExecutorApi.ReadResult,
    | ExecutorApi.FileNotFoundError
    | ExecutorApi.WrongKindError
    | ExecutorApi.FileTooLargeError
    | ExecutorApi.FileSystemError
  >
  readonly write: (
    path: string,
    bytes: Uint8Array,
  ) => Effect.Effect<void, ExecutorApi.FileTooLargeError | ExecutorApi.FileSystemError>
  readonly stat: (
    path: string,
  ) => Effect.Effect<ExecutorApi.FileInfo, ExecutorApi.FileNotFoundError | ExecutorApi.FileSystemError>
  readonly list: (
    path: string,
  ) => Effect.Effect<
    ReadonlyArray<ExecutorApi.DirectoryEntry>,
    ExecutorApi.FileNotFoundError | ExecutorApi.WrongKindError | ExecutorApi.FileSystemError
  >
  readonly remove: (path: string) => Effect.Effect<void, ExecutorApi.FileSystemError>
  readonly move: (
    from: string,
    to: string,
  ) => Effect.Effect<void, ExecutorApi.FileNotFoundError | ExecutorApi.FileSystemError>
  readonly mkdir: (path: string) => Effect.Effect<void, ExecutorApi.FileSystemError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/executor/Executor") {}
