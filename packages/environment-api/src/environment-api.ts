export * as EnvironmentApi from "./environment-api.js"

import { Environment } from "@ren/schema/environment"
import { Identifier } from "@ren/schema/identifier"
import { Brain } from "@ren/schema/brain"
import { Context, Duration, Effect, Schema } from "effect"
import { Rpc, type RpcClientError, RpcGroup, RpcMiddleware } from "effect/rpc"
import { Signal } from "./signal.js"

export const protocol = 2

export const port = 4100

export const pingEvery = Duration.seconds(5)

export const stallAfter = Duration.seconds(15)

// oxlint-disable-next-line ren/no-comments -- A client calls process.heartbeat at least every pingEvery. The executor kills a running process it has not heard from in orphanAfter, even with its output open.
export const orphanAfter = Duration.seconds(30)

// oxlint-disable-next-line ren/no-comments -- Effect RPC frames one NDJSON message in at most 16 MiB and bytes travel as base64, so a message holds about 12 MiB of a file.
export const maxFileBytes = 8 * 1024 * 1024

export const maxUnpackBytes = 100 * 1024 * 1024

export const maxUnpackFiles = 2000

export const ProcessID = Identifier.make("prc", "Executor.ProcessID")
export type ProcessID = typeof ProcessID.Type

export interface Hello extends Schema.Schema.Type<typeof Hello> {}
export const Hello = Schema.Struct({
  protocol: Schema.Int,
  version: Schema.String,
  environmentId: Environment.ID,
  os: Schema.String,
  arch: Schema.String,
  shells: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description: "The shells this machine has, by absolute path. The first is its default.",
    }),
  ),
}).annotate({ identifier: "Executor.Hello" })

export interface SpawnInput extends Schema.Schema.Type<typeof SpawnInput> {}
export const SpawnInput = Schema.Struct({
  command: Schema.NonEmptyString,
  arguments: Schema.Array(Schema.String),
  directory: Schema.optionalKey(Schema.String),
  variables: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  shell: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.String])),
  hasStdin: Schema.optionalKey(Schema.Boolean),
  outputFile: Schema.optionalKey(
    Schema.String.annotate({
      description: "A file on the executor that gets the process’s stdout and stderr, in the order they arrive",
    }),
  ),
}).annotate({ identifier: "Executor.SpawnInput" })

export interface SpawnResult extends Schema.Schema.Type<typeof SpawnResult> {}
export const SpawnResult = Schema.Struct({ id: ProcessID, pid: Schema.Int }).annotate({
  identifier: "Executor.SpawnResult",
})

export const maxWindowBytes = 1024 * 1024

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export interface OutputWindow extends Schema.Schema.Type<typeof OutputWindow> {}
export const OutputWindow = Schema.Struct({
  maxBytes: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(maxWindowBytes)),
  intervalMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({
  identifier: "Executor.OutputWindow",
  description:
    "The reader keeps only the last maxBytes of the output and reads at most once each intervalMs; the rest is a skip",
})

export const ProcessEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("stdout"), offset: Offset, bytes: Schema.Uint8ArrayFromBase64 }),
  Schema.Struct({ type: Schema.Literal("stderr"), offset: Offset, bytes: Schema.Uint8ArrayFromBase64 }),
  Schema.Struct({ type: Schema.Literal("exit"), exitCode: Schema.Int, signal: Schema.Null }),
  Schema.Struct({ type: Schema.Literal("exit"), exitCode: Schema.Null, signal: Signal.Name }),
  Schema.Struct({ type: Schema.Literal("ping") }),
  Schema.Struct({ type: Schema.Literal("skip"), offset: Offset, length: Count, newlines: Count }).annotate({
    description: "Output from offset that a reader with a window does not get: its length and its newlines",
  }),
]).annotate({ identifier: "Executor.ProcessEvent" })
export type ProcessEvent = typeof ProcessEvent.Type

export const FileType = Schema.Literals(["file", "directory", "symlink", "other"]).annotate({
  identifier: "Executor.FileType",
})
export type FileType = typeof FileType.Type

export interface FileInfo extends Schema.Schema.Type<typeof FileInfo> {}
export const FileInfo = Schema.Struct({
  type: FileType,
  sizeBytes: Schema.Int,
  modifiedAtMs: Schema.Number,
}).annotate({ identifier: "Executor.FileInfo" })

export interface DirectoryEntry extends Schema.Schema.Type<typeof DirectoryEntry> {}
export const DirectoryEntry = Schema.Struct({ name: Schema.String, type: FileType }).annotate({
  identifier: "Executor.DirectoryEntry",
})

export interface Range extends Schema.Schema.Type<typeof Range> {}
export const Range = Schema.Struct({
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  length: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "Executor.Range" })

export interface ReadResult extends Schema.Schema.Type<typeof ReadResult> {}
export const ReadResult = Schema.Struct({ info: FileInfo, bytes: Schema.Uint8ArrayFromBase64 }).annotate({
  identifier: "Executor.ReadResult",
})

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()("UnauthorizedError", {
  message: Schema.String,
}) {}

export class FileNotFoundError extends Schema.TaggedError<FileNotFoundError>()("FileNotFoundError", {
  path: Schema.String,
}) {}

export class WrongKindError extends Schema.TaggedError<WrongKindError>()("WrongKindError", {
  path: Schema.String,
  actual: FileType,
}) {}

export class FileSystemError extends Schema.TaggedError<FileSystemError>()("FileSystemError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class SpawnFailedError extends Schema.TaggedError<SpawnFailedError>()("SpawnFailedError", {
  message: Schema.String,
}) {}

export class StdinClosedError extends Schema.TaggedError<StdinClosedError>()("StdinClosedError", {
  id: ProcessID,
}) {}

export class StdinFullError extends Schema.TaggedError<StdinFullError>()("StdinFullError", {
  id: ProcessID,
}) {}

export class FileTooLargeError extends Schema.TaggedError<FileTooLargeError>()("FileTooLargeError", {
  path: Schema.String,
  sizeBytes: Schema.Int,
  maxBytes: Schema.Int,
}) {}

export class ArchiveError extends Schema.TaggedError<ArchiveError>()("ArchiveError", {
  url: Schema.String,
  message: Schema.String,
}) {}

export interface UnpackInput extends Schema.Schema.Type<typeof UnpackInput> {}
export const UnpackInput = Schema.Struct({
  url: Schema.String.annotate({
    description: "A .tar.gz archive with one top-level folder, as GitHub serves a commit",
  }),
  folder: Schema.String.annotate({ description: "The folder inside the archive to keep, or . for all of it" }),
  path: Schema.String.annotate({
    description:
      "Where the folder’s files go. The path appears only when every file is there. An existing path is kept, and nothing is downloaded",
  }),
}).annotate({ identifier: "Executor.UnpackInput" })

export class ProcessNotFoundError extends Schema.TaggedError<ProcessNotFoundError>()("ProcessNotFoundError", {
  id: ProcessID,
}) {}

export class Caller extends Context.Service<Caller, { readonly brain: Brain.ID }>()("@ren/environment-api/Caller") {}

export class Authentication extends RpcMiddleware.Service<
  Authentication,
  { provides: Caller; clientError: RpcClientError.RpcClientError }
>()("@ren/environment-api/Authentication", { error: UnauthorizedError, requiredForClient: true }) {}

const Path = Schema.Struct({ path: Schema.String })

const ProcessRef = { id: ProcessID }

export const Rpcs = RpcGroup.make(
  Rpc.make("executor.hello", { success: Hello }),
  Rpc.make("process.spawn", { payload: SpawnInput, success: SpawnResult, error: SpawnFailedError }),
  Rpc.make("process.output", {
    payload: { ...ProcessRef, cursor: Schema.optionalKey(Offset), window: Schema.optionalKey(OutputWindow) },
    success: ProcessEvent,
    error: ProcessNotFoundError,
    stream: true,
  }),
  Rpc.make("process.write", {
    payload: {
      ...ProcessRef,
      data: Schema.Uint8ArrayFromBase64,
      end: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
    },
    error: Schema.Union([ProcessNotFoundError, StdinFullError, StdinClosedError]),
  }),
  Rpc.make("process.heartbeat", { payload: ProcessRef, error: ProcessNotFoundError }),
  Rpc.make("process.kill", {
    payload: {
      ...ProcessRef,
      signal: Signal.Name.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed<Signal.Name>("SIGTERM"))),
      forceKillAfterMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
    },
    error: ProcessNotFoundError,
  }),
  Rpc.make("files.read", {
    payload: { path: Schema.String, range: Schema.optionalKey(Range) },
    success: ReadResult,
    error: Schema.Union([FileNotFoundError, WrongKindError, FileTooLargeError, FileSystemError]),
  }),
  Rpc.make("files.write", {
    payload: { path: Schema.String, bytes: Schema.Uint8ArrayFromBase64 },
    error: Schema.Union([FileTooLargeError, FileSystemError]),
  }),
  Rpc.make("files.stat", {
    payload: Path,
    success: FileInfo,
    error: Schema.Union([FileNotFoundError, FileSystemError]),
  }),
  Rpc.make("files.list", {
    payload: Path,
    success: Schema.Array(DirectoryEntry),
    error: Schema.Union([FileNotFoundError, WrongKindError, FileSystemError]),
  }),
  Rpc.make("files.remove", { payload: Path, error: FileSystemError }),
  Rpc.make("files.move", {
    payload: { from: Schema.String, to: Schema.String },
    error: Schema.Union([FileNotFoundError, FileSystemError]),
  }),
  Rpc.make("files.mkdir", { payload: Path, error: FileSystemError }),
  Rpc.make("files.unpack", { payload: UnpackInput, error: Schema.Union([ArchiveError, FileSystemError]) }),
).middleware(Authentication)
