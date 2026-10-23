import { DurableObject } from "cloudflare:workers"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"
import { Brain } from "./brain.js"
import { Cell } from "./cell.js"
import { Chat } from "./chat.js"
import { OpenCodeHarness } from "./harness/opencode/harness.js"
import { HostAccess } from "./host-access.js"
import { SettingsHost } from "./settings-host.js"

const ren = Layer.unwrap(
  Effect.gen(function* () {
    const info = yield* Cell.Info
    if (!info.vars.REN_URL) return Layer.empty
    return Layer.mergeAll(EnvironmentConnections.layer.pipe(Layer.provide(HostAccess.layer)), SettingsHost.layer).pipe(
      Layer.provide(FetchHttpClient.layer),
    )
  }),
)

export class SessionCell extends DurableObject {
  readonly runtime = ManagedRuntime.make(
    Layer.mergeAll(Brain.layer, Chat.layer).pipe(
      Layer.provideMerge(OpenCodeHarness.layer(this.ctx.storage).pipe(Layer.provide(ren))),
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
