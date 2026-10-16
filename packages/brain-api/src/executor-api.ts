import { Environment } from "@ren/schema/environment"
import { Identifier } from "@ren/schema/identifier"
import { Brain } from "@ren/schema/brain"
import { Context, Schema } from "effect"
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc"
import { Signal } from "./signal.js"

export const protocol = 1

export const ProcessID = Identifier.make("prc", "Executor.ProcessID")
export type ProcessID = typeof ProcessID.Type

export const Capability = Schema.Literals(["processes", "files"]).annotate({ identifier: "Executor.Capability" })
export type Capability = typeof Capability.Type

export interface Hello extends Schema.Schema.Type<typeof Hello> {}
export const Hello = Schema.Struct({
  protocol: Schema.Int,
  version: Schema.String,
  capabilities: Schema.Array(Capability),
  environmentId: Environment.ID,
  workspaceDirectory: Schema.String,
  os: Schema.String,
  arch: Schema.String,
}).annotate({ identifier: "Executor.Hello" })

export interface SpawnInput extends Schema.Schema.Type<typeof SpawnInput> {}
export const SpawnInput = Schema.Struct({
  command: Schema.NonEmptyString,
  arguments: Schema.Array(Schema.String),
  directory: Schema.optionalKey(Schema.String),
  variables: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  shell: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.String])),
  hasStdin: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Executor.SpawnInput" })

export interface SpawnResult extends Schema.Schema.Type<typeof SpawnResult> {}
export const SpawnResult = Schema.Struct({ id: ProcessID, pid: Schema.Int }).annotate({
  identifier: "Executor.SpawnResult",
})

export const ProcessEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("stdout"), bytes: Schema.Uint8ArrayFromBase64 }),
  Schema.Struct({ type: Schema.Literal("stderr"), bytes: Schema.Uint8ArrayFromBase64 }),
  Schema.Struct({ type: Schema.Literal("exit"), exitCode: Schema.Int, signal: Schema.Null }),
  Schema.Struct({ type: Schema.Literal("exit"), exitCode: Schema.Null, signal: Signal.Name }),
  Schema.Struct({ type: Schema.Literal("ping") }),
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

export class OperationFailedError extends Schema.TaggedError<OperationFailedError>()("OperationFailedError", {
  path: Schema.optionalKey(Schema.String),
  message: Schema.String,
}) {}

export class ProcessNotFoundError extends Schema.TaggedError<ProcessNotFoundError>()("ProcessNotFoundError", {
  id: ProcessID,
}) {}

export class Caller extends Context.Service<Caller, { readonly brain: Brain.ID }>()(
  "@ren/brain-api/ExecutorApi.Caller",
) {}

export class Authentication extends RpcMiddleware.Service<Authentication, { provides: Caller }>()(
  "@ren/brain-api/ExecutorApi.Authentication",
  { error: UnauthorizedError, requiredForClient: true },
) {}

const Path = Schema.Struct({ path: Schema.String })

const ProcessRef = { id: ProcessID }

export const ExecutorApi = RpcGroup.make(
  Rpc.make("executor.hello", { success: Hello }),
  Rpc.make("process.spawn", { payload: SpawnInput, success: SpawnResult, error: OperationFailedError }),
  Rpc.make("process.output", {
    payload: ProcessRef,
    success: ProcessEvent,
    error: ProcessNotFoundError,
    stream: true,
  }),
  Rpc.make("process.write", {
    payload: {
      ...ProcessRef,
      data: Schema.Uint8ArrayFromBase64,
      end: Schema.optionalKey(Schema.Boolean),
    },
    error: Schema.Union([ProcessNotFoundError, OperationFailedError]),
  }),
  Rpc.make("process.kill", {
    payload: {
      ...ProcessRef,
      signal: Schema.optionalKey(Signal.Name),
      forceKillAfterMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
    },
    error: ProcessNotFoundError,
  }),
  Rpc.make("files.read", {
    payload: { path: Schema.String, range: Schema.optionalKey(Range) },
    success: ReadResult,
    error: Schema.Union([FileNotFoundError, WrongKindError, OperationFailedError]),
  }),
  Rpc.make("files.write", {
    payload: { path: Schema.String, bytes: Schema.Uint8ArrayFromBase64 },
    error: OperationFailedError,
  }),
  Rpc.make("files.stat", {
    payload: Path,
    success: FileInfo,
    error: Schema.Union([FileNotFoundError, OperationFailedError]),
  }),
  Rpc.make("files.list", {
    payload: Path,
    success: Schema.Array(DirectoryEntry),
    error: Schema.Union([FileNotFoundError, WrongKindError, OperationFailedError]),
  }),
  Rpc.make("files.remove", { payload: Path, error: OperationFailedError }),
  Rpc.make("files.move", {
    payload: { from: Schema.String, to: Schema.String },
    error: Schema.Union([FileNotFoundError, OperationFailedError]),
  }),
  Rpc.make("files.mkdir", { payload: Path, error: OperationFailedError }),
).middleware(Authentication)
