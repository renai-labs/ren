import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { asc } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse, UrlParams } from "effect/http"
import { DurableRunner } from "../src/durable-runner.js"
import { SandboxUsage } from "../src/sandbox-usage.js"
import { E2BSandbox } from "../src/sandbox-provider/e2b.js"
import { Usage } from "../src/usage.js"
import { testEffect } from "./lib/effect.js"

const tags = {
  owner: "ren-test-a",
  brain: "brn_01M5VZPQGNDCJ83K6SSKJMWH90",
  generation: "7",
  organization: "org_01",
  space: "spc_01",
}

const execution = (vcpu_count: number, memory_mb: number, execution_time: number) => ({
  started_at: "2026-10-29T06:30:00Z",
  vcpu_count,
  memory_mb,
  execution_time,
})

const tenMinutes = execution(2, 2048, 600_000)

const run = (id: string, type: "paused" | "killed", timestamp: string, eventData: object) => ({
  id,
  type: `sandbox.lifecycle.${type}`,
  timestamp,
  sandboxId: "ica9vjpuqmbimf0pqcae4",
  eventData,
})

// oxlint-disable-next-line ren/no-comments -- Newest first, as E2B lists them. Two runs of this Ren's brain; the others are another Ren's, ren-v1's (no metadata), a template smoke test's, and a sandbox's from before the organization tag.
const events = [
  run("e-killed", "killed", "2026-10-29T07:20:00.123456789Z", {
    sandbox_metadata: tags,
    execution: execution(2, 2048, 1_333_545),
    kill_reason: "request",
  }),
  run("e-other-ren", "paused", "2026-10-29T07:10:00Z", {
    sandbox_metadata: { ...tags, owner: "ren-v2-dev" },
    execution: tenMinutes,
  }),
  run("e-ren-v1", "paused", "2026-10-29T07:09:00Z", { execution: tenMinutes }),
  run("e-smoke", "killed", "2026-10-29T07:08:00Z", {
    sandbox_metadata: { owner: tags.owner, smoke: "true" },
    execution: tenMinutes,
    kill_reason: "request",
  }),
  run("e-untagged", "paused", "2026-10-29T07:05:00Z", {
    sandbox_metadata: { owner: tags.owner, brain: tags.brain, generation: "6" },
    execution: tenMinutes,
  }),
  run("e-paused", "paused", "2026-10-29T07:03:06Z", {
    sandbox_metadata: tags,
    execution: execution(8, 8192, 1_818_000),
    pause_mode: "full",
  }),
]

const e2b = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) => {
    const first =
      new URL(request.url).pathname === "/events/sandboxes" &&
      Option.contains(UrlParams.getFirst(request.urlParams, "offset"), "0")
    const page = first ? events : []
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(page)))
  }),
)

const it = testEffect(
  SandboxUsage.layer.pipe(
    Layer.provideMerge(Usage.layer),
    Layer.provide(
      E2BSandbox.layer.pipe(
        Layer.provide(e2b),
        Layer.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown({ E2B_API_KEY: "e2b_test", E2B_OWNER: "ren-test-a" })),
        ),
      ),
    ),
    Layer.provideMerge(DurableRunner.layerMemory),
    Layer.provideMerge(Testing.layer),
  ),
)

const stored = Effect.flatMap(Database.Service, (database) =>
  database.db
    .select()
    .from(Database.Schema.usage_event)
    .orderBy(asc(Database.Schema.usage_event.time))
    .pipe(Effect.orDie),
)

it.live("records each run of this Ren's brains that E2B measured, one time, at E2B's published rates", () =>
  Effect.gen(function* () {
    const usage = yield* SandboxUsage.Service
    yield* usage.sweep
    yield* usage.sweep
    const shared = {
      source: "e2b",
      type: "sandbox.compute",
      workload: `brain:${tags.brain}:7`,
      organization: "org_01",
      brain: tags.brain,
      space: "spc_01",
      payer: "ren",
      provider: "e2b",
    }
    expect(yield* stored).toMatchObject([
      {
        ...shared,
        id: "e-paused",
        time: new Date("2026-10-29T07:03:06Z"),
        cost_micro_usd: 269_064,
        data: {
          sandbox_id: "ica9vjpuqmbimf0pqcae4",
          duration_ms: 1_818_000,
          vcpu_ms: 14_544_000,
          memory_mib_ms: 14_893_056_000,
        },
      },
      {
        ...shared,
        id: "e-killed",
        time: new Date("2026-10-29T07:20:00.123Z"),
        cost_micro_usd: 49_341,
        data: {
          sandbox_id: "ica9vjpuqmbimf0pqcae4",
          duration_ms: 1_333_545,
          vcpu_ms: 2_667_090,
          memory_mib_ms: 2_731_100_160,
        },
      },
    ])
  }),
)
