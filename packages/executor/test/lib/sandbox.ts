export * as TestSandbox from "./sandbox.js"

import { BunServices } from "@effect/platform-bun"
import { ExecutorVariables } from "@ren/hand-api/executor-variables"
import { HandApi } from "@ren/hand-api/hand-api"
import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { ConfigProvider, Effect, Layer, Stream } from "effect"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Executor } from "../../src/executor.js"
import { Sandbox } from "../../src/sandbox.js"

export const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-executor-")))

export const layer = Sandbox.layer.pipe(
  Layer.provide(BunServices.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        EXECUTOR_ENVIRONMENT_ID: Hand.ID.create(),
        EXECUTOR_WORKSPACE: workspace,
        EXECUTOR_SETUP_DIRECTORY: await mkdtemp(join(tmpdir(), "ren-setup-")),
        ...(process.env.SHELL && { SHELL: process.env.SHELL }),
        ...ExecutorVariables.hiding([
          "POSTHOG_PROJECT_KEY",
          "OTEL_EXPORTER_OTLP_HEADERS",
          "REN_BRAIN_ID",
          "PORT",
          "REN_URL",
        ]),
      }),
    ),
  ),
)

export const brain = Brain.ID.create()

export const decoder = new TextDecoder()

export const mebibyte = 1024 * 1024

export const run = Effect.fnUntraced(function* (input: HandApi.SpawnInput) {
  const executor = yield* Executor.Service
  const spawned = yield* executor.spawn(brain, input)
  return { executor, id: spawned.id, pid: spawned.pid, events: yield* executor.output(brain, spawned.id) }
})

export const bytesOf = (events: ReadonlyArray<HandApi.ProcessEvent>, type: "stdout" | "stderr") =>
  new Uint8Array(Buffer.concat(events.flatMap((event) => (event.type === type ? [event.bytes] : []))))

export const collect = (events: Stream.Stream<HandApi.ProcessEvent>) =>
  Stream.runCollect(events).pipe(
    Effect.map((all) => ({
      stdout: all.flatMap((event) => (event.type === "stdout" ? [decoder.decode(event.bytes)] : [])).join(""),
      stderr: all.flatMap((event) => (event.type === "stderr" ? [decoder.decode(event.bytes)] : [])).join(""),
      exit: all.findLast((event) => event.type === "exit"),
    })),
  )
