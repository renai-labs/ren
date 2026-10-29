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

const run = (input: {
  readonly id: string
  readonly type: "paused" | "killed"
  readonly timestamp: string
  readonly metadata?: Readonly<Record<string, string>>
  readonly vcpu: number
  readonly memoryMb: number
  readonly ms: number
  readonly killReason?: string
}) => ({
  id: input.id,
  type: `sandbox.lifecycle.${input.type}`,
  timestamp: input.timestamp,
  sandboxId: "ica9vjpuqmbimf0pqcae4",
  eventData: {
    ...(input.metadata && { sandbox_metadata: input.metadata }),
    execution: {
      started_at: "2026-10-29T06:32:48Z",
      vcpu_count: input.vcpu,
      memory_mb: input.memoryMb,
      execution_time: input.ms,
    },
    ...(input.killReason && { kill_reason: input.killReason }),
  },
})

// oxlint-disable-next-line ren/no-comments -- Newest first, as E2B lists them: two runs of this Ren's brain, and the runs that are not its brains' (another Ren, ren-v1 without metadata, a template smoke test, a sandbox from before the organization tag).
const events = [
  run({
    id: "e-killed",
    type: "killed",
    timestamp: "2026-10-29T07:20:00.123456789Z",
    metadata: tags,
    vcpu: 2,
    memoryMb: 2048,
    ms: 1_333_545,
    killReason: "request",
  }),
  run({
    id: "e-other-ren",
    type: "paused",
    timestamp: "2026-10-29T07:10:00Z",
    metadata: { ...tags, owner: "ren-v2-dev" },
    vcpu: 8,
    memoryMb: 8192,
    ms: 600_000,
  }),
  run({ id: "e-ren-v1", type: "paused", timestamp: "2026-10-29T07:09:00Z", vcpu: 2, memoryMb: 2048, ms: 600_000 }),
  run({
    id: "e-smoke",
    type: "killed",
    timestamp: "2026-10-29T07:08:00Z",
    metadata: { owner: "ren-test-a", smoke: "true" },
    vcpu: 2,
    memoryMb: 2048,
    ms: 7_751,
    killReason: "request",
  }),
  run({
    id: "e-untagged",
    type: "paused",
    timestamp: "2026-10-29T07:05:00Z",
    metadata: { owner: "ren-test-a", brain: tags.brain, generation: "6" },
    vcpu: 8,
    memoryMb: 8192,
    ms: 600_000,
  }),
  run({
    id: "e-paused",
    type: "paused",
    timestamp: "2026-10-29T07:03:06Z",
    metadata: tags,
    vcpu: 8,
    memoryMb: 8192,
    ms: 1_818_000,
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
      root_session: null,
      session: null,
      turn: null,
      member: null,
      agent: null,
      payer: "ren",
      provider: "e2b",
      error: null,
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
          end: "paused",
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
          end: "killed:request",
        },
      },
    ])
  }),
)
