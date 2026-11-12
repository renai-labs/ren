export * as Executor from "./executor.js"

import type { HandApi } from "@ren/hand-api/hand-api"
import type { Signal } from "@ren/hand-api/signal"
import type { Brain } from "@ren/schema/brain"
import { Context, type Effect, type Stream } from "effect"

export interface Interface {
  readonly hello: HandApi.Hello
  readonly spawn: (
    brain: Brain.ID,
    input: HandApi.SpawnInput,
  ) => Effect.Effect<HandApi.SpawnResult, HandApi.SpawnFailedError>
  readonly output: (
    brain: Brain.ID,
    id: HandApi.ProcessID,
    cursor?: number,
    window?: HandApi.OutputWindow,
  ) => Effect.Effect<Stream.Stream<HandApi.ProcessEvent>, HandApi.ProcessNotFoundError>
  readonly writeStdin: (
    brain: Brain.ID,
    id: HandApi.ProcessID,
    input: { readonly data: Uint8Array; readonly end: boolean },
  ) => Effect.Effect<void, HandApi.ProcessNotFoundError | HandApi.StdinFullError | HandApi.StdinClosedError>
  readonly heartbeat: (brain: Brain.ID, id: HandApi.ProcessID) => Effect.Effect<void, HandApi.ProcessNotFoundError>
  readonly kill: (
    brain: Brain.ID,
    id: HandApi.ProcessID,
    signal: Signal.Name,
    forceKillAfterMs?: number,
  ) => Effect.Effect<void, HandApi.ProcessNotFoundError>
  readonly read: (
    path: string,
    range?: HandApi.Range,
  ) => Effect.Effect<
    HandApi.ReadResult,
    HandApi.FileNotFoundError | HandApi.WrongKindError | HandApi.FileTooLargeError | HandApi.FileSystemError
  >
  readonly write: (
    path: string,
    bytes: Uint8Array,
  ) => Effect.Effect<void, HandApi.FileTooLargeError | HandApi.FileSystemError>
  readonly stat: (path: string) => Effect.Effect<HandApi.FileInfo, HandApi.FileNotFoundError | HandApi.FileSystemError>
  readonly list: (
    path: string,
  ) => Effect.Effect<
    ReadonlyArray<HandApi.DirectoryEntry>,
    HandApi.FileNotFoundError | HandApi.WrongKindError | HandApi.FileSystemError
  >
  readonly remove: (path: string) => Effect.Effect<void, HandApi.FileSystemError>
  readonly move: (from: string, to: string) => Effect.Effect<void, HandApi.FileNotFoundError | HandApi.FileSystemError>
  readonly copy: (
    from: string,
    to: string,
  ) => Effect.Effect<void, HandApi.FileNotFoundError | HandApi.WrongKindError | HandApi.FileSystemError>
  readonly mkdir: (path: string) => Effect.Effect<void, HandApi.FileSystemError>
  readonly unpack: (input: HandApi.UnpackInput) => Effect.Effect<void, HandApi.ArchiveError | HandApi.FileSystemError>
  readonly pack: (
    input: HandApi.PackInput,
  ) => Effect.Effect<void, HandApi.ArchiveError | HandApi.FileNotFoundError | HandApi.WrongKindError | HandApi.FileSystemError>
  readonly mount: (input: HandApi.MountInput) => Effect.Effect<void, HandApi.MountError>
  readonly refresh: (input: HandApi.RefreshInput) => Effect.Effect<void, HandApi.MountError>
  readonly uploaded: (input: HandApi.UploadedInput) => Effect.Effect<void, HandApi.MountError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/executor/Executor") {}
