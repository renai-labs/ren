export * as RenWorkspaceDriver from "./workspace-driver.js"

import { EnvironmentFiles } from "@opencode/core/environment/files"
import { RipgrepBinary } from "@opencode/core/ripgrep/binary"
import { Shell } from "@opencode/core/shell"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { Workspace } from "@opencode/schema/workspace"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { FileNotFoundError, FileTooLargeError, WrongKindError } from "@ren/hand-api/executor-api"
import type { Signal } from "@ren/hand-api/signal"
import type { HandConnections } from "@ren/brain/hand-connections"
import { Hand } from "@ren/brain/hand"
import { Identifier } from "@ren/schema/identifier"
import { Session } from "@ren/schema/session"
import { Effect, Layer, Schema } from "effect"
import { OverrideShell } from "./override-shell.js"

export const provider = "ren"

export const workspaceId = (sessionId: Session.ID) => Workspace.ID.make(`wrk_${Identifier.suffix(sessionId)}`)

const killedBySignal = (signal: Signal.Name) => new CrossSpawnSpawner.KilledBySignal(signal)

const files = (hand: Hand.Files): EnvironmentFiles.FilesImpl => {
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
  const writeError = (path: string) => (cause: unknown) =>
    new EnvironmentFiles.Failed({
      path,
      cause:
        cause instanceof FileTooLargeError
          ? new Error(
              `The file ${path} is too large to write in one call (${cause.sizeBytes} bytes, at most ${cause.maxBytes}); write it in parts`,
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
      hand.read(path, range).pipe(
        Effect.map((result) => ({
          bytes: result.bytes,
          info: { type: result.info.type, size: result.info.sizeBytes, mtimeMs: result.info.modifiedAtMs },
        })),
        Effect.mapError(fileKindError(path)),
      ),
    write: (path, bytes) => hand.write(path, bytes).pipe(Effect.mapError(writeError(path))),
    stat: (path) =>
      hand.stat(path).pipe(
        Effect.map((info) => ({ type: info.type, size: info.sizeBytes, mtimeMs: info.modifiedAtMs })),
        Effect.mapError(fileLookupError(path)),
      ),
    list: (path) => hand.list(path).pipe(Effect.mapError(fileKindError(path))),
    remove: (path) => hand.remove(path).pipe(Effect.mapError(fileError(path))),
    move: (from, to) => hand.move(from, to).pipe(Effect.mapError(fileLookupError(from))),
    mkdir: (path) => hand.mkdir(path).pipe(Effect.mapError(fileError(path))),
  }
}

export const session = (connections: HandConnections.Interface, sessionId: Session.ID) => {
  const hand = Hand.session(connections, sessionId, killedBySignal)
  return { spawner: hand.spawner, spawnerWith: hand.spawnerWith, overrides: files(hand.files) }
}

export const replacements = (connections: HandConnections.Interface): LayerNode.Replacements => [
  WorkspaceDriver.node.replace(
    WorkspaceDriver.registryNode({
      [provider]: WorkspaceDriver.make({
        create: () => Effect.succeed({ binding: {} }),
        connect: (input) =>
          Schema.decodeUnknownEffect(Session.ID)(`ses_${Identifier.suffix(input.workspaceID)}`).pipe(
            Effect.map((sessionId) => session(connections, sessionId)),
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
  Shell.node.replace(OverrideShell.node((sessionId) => session(connections, sessionId))),
]
