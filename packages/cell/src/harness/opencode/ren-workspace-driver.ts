export * as RenWorkspaceDriver from "./ren-workspace-driver.js"

import { EnvironmentFiles } from "@opencode/core/environment/files"
import { RipgrepBinary } from "@opencode/core/ripgrep/binary"
import { Shell } from "@opencode/core/shell"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { Workspace } from "@opencode/schema/workspace"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { FileNotFoundError, FileTooLargeError, maxFileBytes, WrongKindError } from "@ren/brain-api/executor-api"
import type { Signal } from "@ren/brain-api/signal"
import type { Environments } from "@ren/brain/environments"
import { Hand } from "@ren/brain/hand"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Effect, Layer, Schema } from "effect"
import { RenShell } from "./ren-shell.js"

export const provider = "ren"

export const workspaceId = (sessionId: Session.ID) =>
  Workspace.ID.make(`wrk_${sessionId.slice(sessionId.indexOf("_") + 1)}`)

const killedBySignal = (signal: Signal.Name) => new CrossSpawnSpawner.KilledBySignal(signal)

const files = (hand: Hand.SessionHand): EnvironmentFiles.FilesImpl => {
  const fileError = (path: string) => (cause: unknown) =>
    new EnvironmentFiles.Failed({
      path,
      cause:
        cause instanceof FileTooLargeError
          ? new Error(
              `The file ${path} is too large (${cause.sizeBytes} bytes, at most ${cause.maxBytes}); use a range`,
            )
          : cause,
    })
  const fileLookupError = (path: string) => (error: unknown) =>
    error instanceof FileNotFoundError ? new EnvironmentFiles.NotFound({ path }) : fileError(path)(error)
  const fileKindError = (path: string) => (error: unknown) =>
    error instanceof WrongKindError
      ? new EnvironmentFiles.WrongKind({ path, actual: error.actual })
      : fileLookupError(path)(error)
  return {
    read: (path, range) =>
      hand
        .files((connection, physical) =>
          connection.client["files.read"]({ path: physical(path), ...(range && { range }) }),
        )
        .pipe(
          Effect.map((result) => ({
            bytes: result.bytes,
            info: { type: result.info.type, size: result.info.sizeBytes, mtimeMs: result.info.modifiedAtMs },
          })),
          Effect.mapError(fileKindError(path)),
        ),
    write: (path, bytes) =>
      bytes.length > maxFileBytes
        ? Effect.fail(
            new EnvironmentFiles.Failed({
              path,
              cause: new Error(
                `The file ${path} is too large to write in one call (${bytes.length} bytes, at most ${maxFileBytes}); write it in parts`,
              ),
            }),
          )
        : hand
            .files((connection, physical) => connection.client["files.write"]({ path: physical(path), bytes }))
            .pipe(Effect.mapError(fileError(path))),
    stat: (path) =>
      hand
        .files((connection, physical) => connection.client["files.stat"]({ path: physical(path) }))
        .pipe(
          Effect.map((info) => ({ type: info.type, size: info.sizeBytes, mtimeMs: info.modifiedAtMs })),
          Effect.mapError(fileLookupError(path)),
        ),
    list: (path) =>
      hand
        .files((connection, physical) => connection.client["files.list"]({ path: physical(path) }))
        .pipe(Effect.mapError(fileKindError(path))),
    remove: (path) =>
      hand
        .files((connection, physical) => connection.client["files.remove"]({ path: physical(path) }))
        .pipe(Effect.mapError(fileError(path))),
    move: (from, to) =>
      hand
        .files((connection, physical) => connection.client["files.move"]({ from: physical(from), to: physical(to) }))
        .pipe(Effect.mapError(fileLookupError(from))),
    mkdir: (path) =>
      hand
        .files((connection, physical) => connection.client["files.mkdir"]({ path: physical(path) }))
        .pipe(Effect.mapError(fileError(path))),
  }
}

export const session = (environments: Environments.Interface, sessionId: Session.ID) => {
  const hand = Hand.session(environments, sessionId, Environment.sessionDirectory(sessionId), killedBySignal)
  return { spawner: hand.spawner, spawnerWith: hand.spawnerWith, overrides: files(hand) }
}

export const replacements = (environments: Environments.Interface): LayerNode.Replacements => [
  WorkspaceDriver.node.replace(
    WorkspaceDriver.registryNode({
      [provider]: WorkspaceDriver.make({
        create: () => Effect.succeed({ binding: {} }),
        connect: (input) =>
          Schema.decodeUnknownEffect(Session.ID)(
            `ses_${input.workspaceID.slice(input.workspaceID.indexOf("_") + 1)}`,
          ).pipe(
            Effect.map((sessionId) => session(environments, sessionId)),
            Effect.mapError((cause) => new WorkspaceDriver.Error({ message: cause.message, cause })),
          ),
        suspendForIdle: () => Effect.void,
        destroy: () => Effect.void,
      }),
    }),
  ),
  RipgrepBinary.node.replace(
    Layer.succeed(RipgrepBinary.Service, RipgrepBinary.Service.of({ filepath: Effect.succeed("rg") })),
  ),
  Shell.node.replace(RenShell.node((sessionId) => session(environments, sessionId))),
]
