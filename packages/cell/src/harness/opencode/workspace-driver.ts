export * as RenWorkspaceDriver from "./workspace-driver.js"

import { EnvironmentFiles } from "@opencode/core/environment/files"
import { RipgrepBinary } from "@opencode/core/ripgrep/binary"
import { Shell } from "@opencode/core/shell"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { Workspace } from "@opencode/schema/workspace"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { EnvironmentApi } from "@ren/environment-api/environment-api"
import type { Signal } from "@ren/environment-api/signal"
import type { EnvironmentConnections } from "@ren/brain/environment/connections"
import { EnvironmentSession } from "@ren/brain/environment/session"
import { Identifier } from "@ren/schema/identifier"
import { Session } from "@ren/schema/session"
import { Effect, Layer } from "effect"
import { RenShell } from "./shell.js"

export const provider = "ren"

export const workspaceId = (sessionId: Session.ID) => Workspace.ID.make(`wrk_${Identifier.suffix(sessionId)}`)

export const sessionIdOf = (workspaceId: Workspace.ID) => Session.ID.make(`ses_${Identifier.suffix(workspaceId)}`)

export const killedBySignal = (signal: Signal.Name) => new CrossSpawnSpawner.KilledBySignal(signal)

const files = (environment: EnvironmentSession.Files): EnvironmentFiles.FilesImpl => {
  const fileError = (path: string) => (cause: unknown) =>
    new EnvironmentFiles.Failed({
      path,
      cause:
        cause instanceof EnvironmentApi.FileTooLargeError
          ? new Error(
              `The file ${path} is too large (${cause.sizeBytes} bytes, at most ${cause.maxBytes}); use a range`,
            )
          : cause,
    })
  const writeError = (path: string) => (cause: unknown) =>
    new EnvironmentFiles.Failed({
      path,
      cause:
        cause instanceof EnvironmentApi.FileTooLargeError
          ? new Error(
              `The file ${path} is too large to write in one call (${cause.sizeBytes} bytes, at most ${cause.maxBytes}); write it in parts`,
            )
          : cause,
    })
  const fileLookupError = (path: string) => (error: unknown) =>
    error instanceof EnvironmentApi.FileNotFoundError ? new EnvironmentFiles.NotFound({ path }) : fileError(path)(error)
  const fileKindError = (path: string) => (error: unknown) =>
    error instanceof EnvironmentApi.WrongKindError
      ? new EnvironmentFiles.WrongKind({ path, actual: error.actual })
      : fileLookupError(path)(error)
  return {
    read: (path, range) =>
      environment.read(path, range).pipe(
        Effect.map((result) => ({
          bytes: result.bytes,
          info: { type: result.info.type, size: result.info.sizeBytes, mtimeMs: result.info.modifiedAtMs },
        })),
        Effect.mapError(fileKindError(path)),
      ),
    write: (path, bytes) => environment.write(path, bytes).pipe(Effect.mapError(writeError(path))),
    stat: (path) =>
      environment.stat(path).pipe(
        Effect.map((info) => ({ type: info.type, size: info.sizeBytes, mtimeMs: info.modifiedAtMs })),
        Effect.mapError(fileLookupError(path)),
      ),
    list: (path) => environment.list(path).pipe(Effect.mapError(fileKindError(path))),
    remove: (path) => environment.remove(path).pipe(Effect.mapError(fileError(path))),
    move: (from, to) => environment.move(from, to).pipe(Effect.mapError(fileLookupError(from))),
    mkdir: (path) => environment.mkdir(path).pipe(Effect.mapError(fileError(path))),
  }
}

export const session = (connections: EnvironmentConnections.Interface, sessionId: Session.ID) => {
  const environment = EnvironmentSession.make(connections, sessionId, killedBySignal)
  return { spawner: environment.spawner, spawnerWith: environment.spawnerWith, overrides: files(environment.files) }
}

export const replacements = (connections: EnvironmentConnections.Interface): LayerNode.Replacements => [
  WorkspaceDriver.node.replace(
    WorkspaceDriver.registryNode({
      [provider]: WorkspaceDriver.make({
        create: () => Effect.succeed({ binding: {} }),
        connect: (input) => Effect.succeed(session(connections, sessionIdOf(input.workspaceID))),
        suspendForIdle: () => Effect.void,
        destroy: () => Effect.void,
      }),
    }),
  ),
  RipgrepBinary.node.replace(
    Layer.succeed(RipgrepBinary.Service, RipgrepBinary.Service.of({ filepath: Effect.succeed("rg") })),
  ),
  Shell.node.replace(RenShell.node((workspaceId) => session(connections, sessionIdOf(workspaceId)))),
]
