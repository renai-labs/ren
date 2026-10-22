import { DurableObject } from "cloudflare:workers"
import { Layer, ManagedRuntime } from "effect"
import { Brain } from "./brain.js"
import { BrainKeys } from "./brain-keys.js"
import { Cell } from "./cell.js"
import { Chat } from "./chat.js"
import { ChatSettings } from "./chat-settings.js"
import { OpenCodeHarness } from "./harness/opencode/harness.js"
import { HostAccess } from "./host-access.js"
import { HotReload } from "./hot-reload.js"

export class SessionCell extends DurableObject {
  readonly runtime = ManagedRuntime.make(
    Layer.mergeAll(Brain.layer, Chat.layer).pipe(
      Layer.provideMerge(HotReload.layer),
      Layer.provideMerge(OpenCodeHarness.layer(this.ctx.storage).pipe(Layer.provide(HostAccess.connections))),
      Layer.provideMerge(Layer.mergeAll(ChatSettings.layer, BrainKeys.layer)),
      Layer.provideMerge(Cell.layer(this.ctx.storage, this.ctx.id.name, this.env)),
    ),
  )

  override fetch(request: Request) {
    return this.runtime.runPromise(Cell.fetch(request))
  }

  override alarm() {
    return this.runtime.runPromise(Cell.alarm())
  }
}
