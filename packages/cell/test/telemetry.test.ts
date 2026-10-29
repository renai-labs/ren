import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { hostTokenHeader } from "@ren/host-api/brain-api"
import { Brain } from "@ren/schema/brain"
import { BrainToken } from "@ren/host-api/brain-token"
import { EnvironmentTelemetry } from "@ren/brain/environment/telemetry"
import { Effect, Layer, Option, Schema } from "effect"
import { BrainTelemetry } from "../src/brain-telemetry.js"
import { Cell } from "../src/cell.js"
import { Env } from "../src/env.js"
import { HostToken } from "../src/host-token.js"
import { RenAddress } from "../src/ren-address.js"
import { BunBrain } from "./lib/bun-brain.js"
import { FakeRen } from "./lib/ren.js"
import { Shared } from "./lib/shared.js"
import { TestToken } from "./lib/token.js"

setDefaultTimeout(120_000)

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((each) => each()))
})

const Spans = Schema.Struct({
  resource: Schema.Struct({
    attributes: Schema.Array(
      Schema.Struct({ key: Schema.String, value: Schema.Struct({ stringValue: Schema.String }) }),
    ),
  }),
  scopeSpans: Schema.Array(Schema.Struct({ spans: Schema.Array(Schema.Struct({ traceId: Schema.String })) })),
})

test("a brain continues Ren's sampled trace, traces nothing else, and sends its spans to Ren with its own host token when it stops", async () => {
  const ren = FakeRen.start()
  ren.models(Shared.access())
  const brain = Brain.ID.create()
  const instance = await BunBrain.make(
    { ...Shared.vars(Shared.stub().url), REN_URL: ren.url, REN_TELEMETRY: "traces,logs" },
    { brain },
  )
  cleanup.push(instance.dispose, ren.stop)
  const hostToken = await FakeRen.hostToken(brain)
  const traceId = "0af7651916cd43dd8448eb211c80319c"
  const wake = await fetch(`${instance.url}/ren/wake`, {
    method: "POST",
    headers: {
      authorization: TestToken.basic(await TestToken.sign({ scope: "server", brain, gen: 1, exp: TestToken.exp() })),
      [hostTokenHeader]: hostToken,
      traceparent: `00-${traceId}-b7ad6b7169203331-01`,
    },
  })
  expect(wake.status).toBe(204)
  await ren.reached(brain)
  await instance.kill("SIGTERM")

  const exports = ren.exported.filter((entry) => entry.signal === "traces")
  const resources = exports.flatMap((entry) =>
    entry.batch.resourceSpans.map((resource) => Schema.decodeUnknownSync(Spans)(resource)),
  )
  const presentedBy = await Promise.all(
    exports.map((entry) =>
      Effect.runPromise(BrainToken.verify(TestToken.publicKeys, entry.hostToken)).then((claims) =>
        Option.map(claims, (found) => found.brain),
      ),
    ),
  )
  expect(presentedBy).toEqual(exports.map(() => Option.some(brain)))
  expect(
    resources.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans.map((span) => span.traceId))),
  ).toContain(traceId)
  expect(
    new Set(
      resources.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans.map((span) => span.traceId))),
    ),
  ).toEqual(new Set([traceId]))
  expect(resources[0]?.resource.attributes).toContainEqual({ key: "service.name", value: { stringValue: "ren-brain" } })
})

test("forwards an environment's drained batches to Ren with the host token, only for the signals that Ren accepts", async () => {
  const ren = FakeRen.start()
  cleanup.push(ren.stop)
  const brain = Brain.ID.create()
  const hostToken = await FakeRen.hostToken(brain)
  const resource = { attributes: [{ key: "service.name", value: { stringValue: "ren-executor" } }] }
  const batch = { resourceSpans: [{ resource, scopeSpans: [] }] }
  const traces = JSON.stringify(batch)
  const logs = JSON.stringify({ resourceLogs: [{ resource, scopeLogs: [] }] })
  const info = Cell.Info.of({
    storage: { getAlarm: () => Promise.resolve(null), setAlarm: () => Promise.resolve() },
    brainId: brain,
    generation: 1,
    version: "test",
    vars: Schema.decodeUnknownSync(Env.Vars)({ ...TestToken.vars, REN_URL: ren.url, REN_TELEMETRY: "traces" }),
  })
  await Effect.gen(function* () {
    const telemetry = yield* EnvironmentTelemetry.Service
    yield* telemetry.forward({ traces: [traces], logs: [logs] })
  }).pipe(
    Effect.provide(BrainTelemetry.layer),
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(Cell.Info, info),
        Layer.succeed(
          HostToken.Service,
          HostToken.Service.of({ current: Effect.succeed(Option.some(hostToken)), isValid: Effect.succeed(true) }),
        ),
        RenAddress.layerFixed(ren.url),
      ),
    ),
    Effect.runPromise,
  )

  expect(ren.exported.map((entry) => [entry.signal, entry.hostToken])).toEqual([["traces", hostToken]])
  expect(ren.exported.at(0)?.batch).toEqual(batch)
})
