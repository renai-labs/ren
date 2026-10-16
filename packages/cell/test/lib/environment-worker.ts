import { DurableObject } from "cloudflare:workers"
import { Environments } from "@ren/brain/environments"
import { EnvironmentAccess } from "@ren/brain/environment-access"
import { Environment } from "@ren/schema/environment"
import { Layer, ManagedRuntime, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Brain } from "../../src/brain.js"
import { Cell } from "../../src/cell.js"
import { OpenCodeHarness } from "../../src/harness/opencode/harness.js"
import worker from "../../src/worker.js"

const Vars = Schema.Struct({
  TEST_ENVIRONMENT_ACCESS: Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Environment.Access))),
})

export class SessionCell extends DurableObject {
  readonly runtime = ManagedRuntime.make(
    Brain.layer.pipe(
      Layer.provideMerge(
        OpenCodeHarness.layer(this.ctx.storage).pipe(
          Layer.provide(
            Environments.layer.pipe(
              Layer.provide(
                EnvironmentAccess.layerFixed(Schema.decodeUnknownSync(Vars)(this.env).TEST_ENVIRONMENT_ACCESS),
              ),
              Layer.provide(FetchHttpClient.layer),
            ),
          ),
        ),
      ),
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

// oxlint-disable-next-line import/no-default-export -- celld and wrangler load the worker's default export
export default worker
