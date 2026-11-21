export * as FileSystem from "./file-system.js"

import type { FileSystem } from "@ren/schema/file-system"
import { Context, Effect, Layer } from "effect"
import type { Actor } from "./actor.js"
import { Drives } from "./drives.js"
import { FileSystemProvider } from "./file-system/provider.js"
import { Memory } from "./memory.js"

export interface Interface {
  readonly list: (
    actor: Actor.Info,
    input: FileSystem.ListInput,
  ) => Effect.Effect<FileSystem.Page, FileSystemProvider.Error>
  readonly read: (
    actor: Actor.Info,
    input: FileSystem.PathInput,
  ) => Effect.Effect<FileSystem.Content, FileSystemProvider.Error>
  readonly remove: (actor: Actor.Info, input: FileSystem.PathInput) => Effect.Effect<void, FileSystemProvider.Error>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/FileSystem") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const drives = yield* Drives.Service
    const memory = yield* Memory.Service
    const providers: Record<FileSystem.Source, FileSystemProvider.Interface> = {
      drive: drives.fileSystem,
      memory: memory.fileSystem,
    }
    return Service.of({
      list: (actor, input) => providers[input.source].list(actor, input),
      read: (actor, input) => providers[input.source].read(actor, input),
      remove: (actor, input) => providers[input.source].remove(actor, input),
    })
  }),
)
