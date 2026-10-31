import { expect } from "bun:test"
import { HandApi } from "@ren/hand-api/hand-api"
import type { Packages } from "@ren/schema/packages"
import { Effect } from "effect"
import { join } from "node:path"
import { Executor } from "../src/executor.js"
import { testEffect } from "./lib/effect.js"
import { TestSandbox } from "./lib/sandbox.js"

const it = testEffect(TestSandbox.layer)
const workspace = TestSandbox.workspace

const shell = (command: string): Packages.Step => ({ command, user: "user" })

const read = (path: string) => Effect.promise(() => Bun.file(path).text())

it.live("two calls at once run each entry once, in order", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const log = join(workspace, `${crypto.randomUUID()}.log`)
    const entries = [
      { key: crypto.randomUUID(), name: "base", steps: [shell(`echo base >> ${log}`)] },
      {
        key: crypto.randomUUID(),
        name: "tools",
        steps: [shell(`echo tools-1 >> ${log}`), shell(`echo tools-2 >> ${log}`)],
      },
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
    const flaky = `echo run >> ${log}; test -e ${ready} || { echo not ready >&2; exit 4; }`
    const entries = [
      { key: crypto.randomUUID(), name: "flaky", steps: [shell(flaky)] },
      { key: crypto.randomUUID(), name: "after", steps: [shell(`echo after >> ${log}`)] },
    ]
    expect(yield* Effect.flip(executor.setup(entries))).toEqual(
      new HandApi.SetupFailedError({ message: `Setup of flaky failed: ${flaky} exited with 4: not ready` }),
    )
    yield* Effect.promise(() => Bun.write(ready, ""))
    yield* executor.setup(entries)
    yield* executor.setup(entries)
    expect(yield* read(log)).toBe("run\nafter\nrun\n")
  }),
)

it.live("a step does not get the variables Ren gave the machine for itself", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const log = join(workspace, `${crypto.randomUUID()}.log`)
    yield* Effect.acquireRelease(
      Effect.sync(() => Object.assign(process.env, { REN_BRAIN_ID: "brn_ren" })),
      () => Effect.sync(() => delete process.env.REN_BRAIN_ID),
    )
    yield* executor.setup([
      { key: crypto.randomUUID(), name: "env", steps: [shell(`echo "[$REN_BRAIN_ID]" >> ${log}`)] },
    ])
    expect(yield* read(log)).toBe("[]\n")
  }),
)
