import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { hostTokenHeader } from "@ren/host-api/brain-api"
import { Brain } from "@ren/schema/brain"
import { Schema } from "effect"
import { BunBrain } from "./lib/bun-brain.js"
import { FakeRen } from "./lib/ren.js"
import { Shared } from "./lib/shared.js"
import { TestToken } from "./lib/token.js"

setDefaultTimeout(120_000)

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((each) => each()))
})

const Traces = Schema.fromJsonString(
  Schema.Struct({
    resourceSpans: Schema.Array(
      Schema.Struct({
        resource: Schema.Struct({
          attributes: Schema.Array(
            Schema.Struct({ key: Schema.String, value: Schema.Struct({ stringValue: Schema.String }) }),
          ),
        }),
        scopeSpans: Schema.Array(Schema.Struct({ spans: Schema.Array(Schema.Struct({ traceId: Schema.String })) })),
      }),
    ),
  }),
)

test("a brain continues Ren's sampled trace, traces nothing else, and sends its spans with its tenant to the OTLP endpoint in its env when it stops", async () => {
  const exported: Array<typeof Traces.Type> = []
  const receiver = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname === "/v1/traces")
        exported.push(Schema.decodeUnknownSync(Traces)(await request.text()))
      return Response.json({})
    },
  })
  const ren = FakeRen.start()
  ren.models(Shared.access())
  const brain = Brain.ID.create()
  const instance = await BunBrain.make(
    {
      ...Shared.vars(Shared.stub().url),
      REN_URL: ren.url,
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${receiver.port}`,
      OTEL_RESOURCE_ATTRIBUTES: `ren.brain.id=${brain}`,
    },
    { brain },
  )
  cleanup.push(instance.dispose, ren.stop, () => receiver.stop(true))
  const traceId = "0af7651916cd43dd8448eb211c80319c"
  const wake = await fetch(`${instance.url}/ren/wake`, {
    method: "POST",
    headers: {
      authorization: TestToken.basic(await TestToken.sign({ scope: "server", brain, gen: 1, exp: TestToken.exp() })),
      [hostTokenHeader]: await FakeRen.hostToken(brain),
      traceparent: `00-${traceId}-b7ad6b7169203331-01`,
    },
  })
  expect(wake.status).toBe(204)
  await ren.reached(brain)
  await instance.kill("SIGTERM")

  const resources = exported.flatMap((batch) => batch.resourceSpans)
  expect(
    new Set(
      resources.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans.map((span) => span.traceId))),
    ),
  ).toEqual(new Set([traceId]))
  expect(resources[0]?.resource.attributes).toEqual(
    expect.arrayContaining([
      { key: "service.name", value: { stringValue: "ren-brain" } },
      { key: "ren.brain.id", value: { stringValue: brain } },
    ]),
  )
})
