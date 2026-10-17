import { DurableObject } from "cloudflare:workers"
import { Environments } from "@ren/brain/environments"
import { EnvironmentAccess } from "@ren/brain/environment-access"
import { Environment } from "@ren/schema/environment"
import { Duration, Effect, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"
import { Brain } from "../../src/brain.js"
import { Cell } from "../../src/cell.js"
import { OpenCodeHarness } from "../../src/harness/opencode/harness.js"
import worker from "../../src/worker.js"

const Vars = Schema.Union([
  Schema.Struct({
    TEST_ENVIRONMENT_ACCESS: Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Environment.Access))),
  }),
  Schema.Struct({ CHAOS_CONTROL_URL: Schema.String }),
])

const Changes = Schema.Struct({ version: Schema.Int, ids: Schema.Array(Environment.ID) })

const controlled = (control: string) =>
  Layer.effect(
    EnvironmentAccess.Service,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const changes = (after: number) =>
        http.get(`${control}/environments/changes?after=${after}`).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Changes)),
          Effect.map((body) => [body.ids, Option.some(body.version)] as const),
          Effect.catch((error) =>
            Effect.logWarning("Polling the chaos control server for environment changes failed", error).pipe(
              Effect.andThen(Effect.sleep(Duration.millis(250))),
              Effect.as([[], Option.some(after)] as const),
            ),
          ),
        )
      return EnvironmentAccess.Service.of({
        open: (id) =>
          http.get(`${control}/environments/${id}`).pipe(
            Effect.orDie,
            Effect.flatMap((response) =>
              response.status === 404
                ? Effect.fail(new EnvironmentAccess.NotFound({ environmentId: id }))
                : HttpClientResponse.filterStatusOk(response).pipe(
                    Effect.flatMap(HttpClientResponse.schemaBodyJson(Environment.Access)),
                    Effect.orDie,
                  ),
            ),
          ),
        subscribe: Effect.succeed(Stream.paginate(0, changes)),
      })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer))

export class SessionCell extends DurableObject {
  readonly runtime = ManagedRuntime.make(
    Brain.layer.pipe(
      Layer.provideMerge(
        OpenCodeHarness.layer(this.ctx.storage).pipe(
          Layer.provide(
            Environments.layer.pipe(
              Layer.provide(
                Layer.unwrap(
                  Schema.decodeUnknownEffect(Vars)(this.env).pipe(
                    Effect.orDie,
                    Effect.map((vars) =>
                      "TEST_ENVIRONMENT_ACCESS" in vars
                        ? EnvironmentAccess.layerFixed(vars.TEST_ENVIRONMENT_ACCESS)
                        : controlled(vars.CHAOS_CONTROL_URL),
                    ),
                  ),
                ),
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
