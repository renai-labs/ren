export * as Executor from "./executor.js"

import type { EnvironmentApi } from "@ren/environment-api/environment-api"
import type { Signal } from "@ren/environment-api/signal"
import type { Brain } from "@ren/schema/brain"
import { Context, type Effect, type Stream } from "effect"

export interface Interface {
  readonly hello: EnvironmentApi.Hello
  readonly spawn: (
    brain: Brain.ID,
    input: EnvironmentApi.SpawnInput,
  ) => Effect.Effect<EnvironmentApi.SpawnResult, EnvironmentApi.SpawnFailedError>
  readonly output: (
    brain: Brain.ID,
    id: EnvironmentApi.ProcessID,
    cursor?: number,
    window?: EnvironmentApi.OutputWindow,
  ) => Effect.Effect<Stream.Stream<EnvironmentApi.ProcessEvent>, EnvironmentApi.ProcessNotFoundError>
  readonly writeStdin: (
    brain: Brain.ID,
    id: EnvironmentApi.ProcessID,
    input: { readonly data: Uint8Array; readonly end: boolean },
  ) => Effect.Effect<
    void,
    EnvironmentApi.ProcessNotFoundError | EnvironmentApi.StdinFullError | EnvironmentApi.StdinClosedError
  >
  readonly heartbeat: (
    brain: Brain.ID,
    id: EnvironmentApi.ProcessID,
  ) => Effect.Effect<void, EnvironmentApi.ProcessNotFoundError>
  readonly kill: (
    brain: Brain.ID,
    id: EnvironmentApi.ProcessID,
    signal: Signal.Name,
    forceKillAfterMs?: number,
  ) => Effect.Effect<void, EnvironmentApi.ProcessNotFoundError>
  readonly read: (
    path: string,
    range?: EnvironmentApi.Range,
  ) => Effect.Effect<
    EnvironmentApi.ReadResult,
    | EnvironmentApi.FileNotFoundError
    | EnvironmentApi.WrongKindError
    | EnvironmentApi.FileTooLargeError
    | EnvironmentApi.FileSystemError
  >
  readonly write: (
    path: string,
    bytes: Uint8Array,
  ) => Effect.Effect<void, EnvironmentApi.FileTooLargeError | EnvironmentApi.FileSystemError>
  readonly stat: (
    path: string,
  ) => Effect.Effect<EnvironmentApi.FileInfo, EnvironmentApi.FileNotFoundError | EnvironmentApi.FileSystemError>
  readonly list: (
    path: string,
  ) => Effect.Effect<
    ReadonlyArray<EnvironmentApi.DirectoryEntry>,
    EnvironmentApi.FileNotFoundError | EnvironmentApi.WrongKindError | EnvironmentApi.FileSystemError
  >
  readonly remove: (path: string) => Effect.Effect<void, EnvironmentApi.FileSystemError>
  readonly move: (
    from: string,
    to: string,
  ) => Effect.Effect<void, EnvironmentApi.FileNotFoundError | EnvironmentApi.FileSystemError>
  readonly mkdir: (path: string) => Effect.Effect<void, EnvironmentApi.FileSystemError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/executor/Executor") {}
