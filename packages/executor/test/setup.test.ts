import { expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Environment } from "@ren/schema/environment"
import type { Packages } from "@ren/schema/packages"
import { ConfigProvider, Effect, Layer } from "effect"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Executor } from "../src/executor.js"
import { Sandbox } from "../src/sandbox.js"
import { testEffect } from "./lib/effect.js"

const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-executor-")))
const it = testEffect(
  Sandbox.layer.pipe(
    Layer.provide(BunServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          EXECUTOR_ENVIRONMENT_ID: Environment.ID.create(),
          EXECUTOR_WORKSPACE: workspace,
          EXECUTOR_SETUP_DIRECTORY: await mkdtemp(join(tmpdir(), "ren-setup-")),
        }),
      ),
    ),
  ),
)

const shell = (line: string): Packages.Step => ({ command: "sh", arguments: ["-c", line], root: false })

const read = (path: string) => Effect.promise(() => Bun.file(path).text())

it.live("two calls at once run each entry once, in order", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const log = join(workspace, `${crypto.randomUUID()}.log`)
    const entries = [
      { key: "base", name: "base", steps: [shell(`echo base >> ${log}`)] },
      { key: "tools", name: "tools", steps: [shell(`echo tools-1 >> ${log}`), shell(`echo tools-2 >> ${log}`)] },
    ]
    yield* Effect.all([executor.setup(entries), executor.setup(entries)], { concurrency: 2 })
    expect(yield* read(log)).toBe("base\ntools-1\ntools-2\n")
  }),
)

it.live("a failed entry leaves no mark and does not stop the others; the next call runs it again", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const log = join(workspace, `${crypto.randomUUID()}.log`)
    const ready = join(workspace, crypto.randomUUID())
    const entries = [
      {
        key: "flaky",
        name: "flaky",
        steps: [shell(`echo run >> ${log}; test -e ${ready} || { echo not ready >&2; exit 4; }`)],
      },
      { key: "after", name: "after", steps: [shell(`echo after >> ${log}`)] },
    ]
    expect(yield* Effect.flip(executor.setup(entries))).toEqual(
      new EnvironmentApi.SetupFailedError({ message: "Setup of flaky failed: sh exited with 4: not ready" }),
    )
    yield* Effect.promise(() => Bun.write(ready, ""))
    yield* executor.setup(entries)
    yield* executor.setup(entries)
    expect(yield* read(log)).toBe("run\nafter\nrun\n")
  }),
)

it.live("a command that does not exist fails the setup with its name", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const failure = yield* Effect.flip(
      executor.setup([
        { key: "missing", name: "missing", steps: [{ command: "ren-missing-tool", arguments: [], root: false }] },
      ]),
    )
    expect(failure.message).toStartWith("Setup of missing failed: ren-missing-tool did not start")
  }),
)
