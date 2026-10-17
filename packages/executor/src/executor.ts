export * as Executor from "./executor.js"

import type {
  DirectoryEntry,
  FileInfo,
  FileNotFoundError,
  FileTooLargeError,
  Hello,
  OperationFailedError,
  ProcessEvent,
  ProcessID,
  ProcessNotFoundError,
  Range,
  ReadResult,
  SpawnInput,
  SpawnResult,
  StdinFullError,
  WrongKindError,
} from "@ren/brain-api/executor-api"
import type { Signal } from "@ren/brain-api/signal"
import type { Brain } from "@ren/schema/brain"
import { Context, type Effect, type Stream } from "effect"

export interface Interface {
  readonly hello: Hello
  readonly spawn: (brain: Brain.ID, input: SpawnInput) => Effect.Effect<SpawnResult, OperationFailedError>
  readonly output: (
    brain: Brain.ID,
    id: ProcessID,
    cursor?: number,
  ) => Effect.Effect<Stream.Stream<ProcessEvent>, ProcessNotFoundError>
  readonly writeStdin: (
    brain: Brain.ID,
    id: ProcessID,
    data: Uint8Array,
    end: boolean,
  ) => Effect.Effect<void, ProcessNotFoundError | StdinFullError | OperationFailedError>
  readonly heartbeat: (brain: Brain.ID, id: ProcessID) => Effect.Effect<void, ProcessNotFoundError>
  readonly kill: (
    brain: Brain.ID,
    id: ProcessID,
    signal: Signal.Name,
    forceKillAfterMs?: number,
  ) => Effect.Effect<void, ProcessNotFoundError>
  readonly read: (
    path: string,
    range?: Range,
  ) => Effect.Effect<ReadResult, FileNotFoundError | WrongKindError | FileTooLargeError | OperationFailedError>
  readonly write: (path: string, bytes: Uint8Array) => Effect.Effect<void, FileTooLargeError | OperationFailedError>
  readonly stat: (path: string) => Effect.Effect<FileInfo, FileNotFoundError | OperationFailedError>
  readonly list: (
    path: string,
  ) => Effect.Effect<ReadonlyArray<DirectoryEntry>, FileNotFoundError | WrongKindError | OperationFailedError>
  readonly remove: (path: string) => Effect.Effect<void, OperationFailedError>
  readonly move: (from: string, to: string) => Effect.Effect<void, FileNotFoundError | OperationFailedError>
  readonly mkdir: (path: string) => Effect.Effect<void, OperationFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/executor/Executor") {}
