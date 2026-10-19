export * as Executor from "./executor.js"

import type {
  DirectoryEntry,
  FileInfo,
  FileNotFoundError,
  FileTooLargeError,
  Hello,
  FileSystemError,
  OutputWindow,
  ProcessEvent,
  ProcessID,
  ProcessNotFoundError,
  Range,
  ReadResult,
  SpawnFailedError,
  SpawnInput,
  SpawnResult,
  StdinClosedError,
  StdinFullError,
  WrongKindError,
} from "@ren/hand-api/executor-api"
import type { Signal } from "@ren/hand-api/signal"
import type { Brain } from "@ren/schema/brain"
import { Context, type Effect, type Stream } from "effect"

export interface Interface {
  readonly hello: Hello
  readonly spawn: (brain: Brain.ID, input: SpawnInput) => Effect.Effect<SpawnResult, SpawnFailedError>
  readonly output: (
    brain: Brain.ID,
    id: ProcessID,
    cursor?: number,
    window?: OutputWindow,
  ) => Effect.Effect<Stream.Stream<ProcessEvent>, ProcessNotFoundError>
  readonly writeStdin: (
    brain: Brain.ID,
    id: ProcessID,
    input: { readonly data: Uint8Array; readonly end: boolean },
  ) => Effect.Effect<void, ProcessNotFoundError | StdinFullError | StdinClosedError>
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
  ) => Effect.Effect<ReadResult, FileNotFoundError | WrongKindError | FileTooLargeError | FileSystemError>
  readonly write: (path: string, bytes: Uint8Array) => Effect.Effect<void, FileTooLargeError | FileSystemError>
  readonly stat: (path: string) => Effect.Effect<FileInfo, FileNotFoundError | FileSystemError>
  readonly list: (
    path: string,
  ) => Effect.Effect<ReadonlyArray<DirectoryEntry>, FileNotFoundError | WrongKindError | FileSystemError>
  readonly remove: (path: string) => Effect.Effect<void, FileSystemError>
  readonly move: (from: string, to: string) => Effect.Effect<void, FileNotFoundError | FileSystemError>
  readonly mkdir: (path: string) => Effect.Effect<void, FileSystemError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/executor/Executor") {}
