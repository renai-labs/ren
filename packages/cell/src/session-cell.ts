import { DurableObject } from "cloudflare:workers"
import { Environments } from "@ren/brain/environments"
import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/http"
import { Brain } from "./brain.js"
import { Cell } from "./cell.js"
import { OpenCodeHarness } from "./harness/opencode/harness.js"
import { HostAccess } from "./host-access.js"

const environments = Layer.unwrap(
  Effect.gen(function* () {
    const info = yield* Cell.Info
    if (!info.vars.REN_URL) return Layer.empty
    return Environments.layer.pipe(
      Layer.provide(HostAccess.layer(info.vars.REN_URL)),
      Layer.provide(FetchHttpClient.layer),
    )
  }),
)

export class SessionCell extends DurableObject {
  readonly runtime = ManagedRuntime.make(
    Brain.layer.pipe(
      Layer.provideMerge(OpenCodeHarness.layer(this.ctx.storage).pipe(Layer.provide(environments))),
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
