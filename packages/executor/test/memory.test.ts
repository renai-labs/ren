import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SandboxMemory } from "../src/sandbox/memory.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Layer.empty)

const mebibyte = 1024 * 1024

it.effect("the used memory of the tools' cgroup leaves out the file cache that the kernel can reclaim", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "ren-memory-")))
    const slice = join(root, "sys/fs/cgroup/ren.slice/ren-tools.slice")
    const files = {
      "proc/self/cgroup": "0::/ren.slice/ren-tools.slice/run-1.scope\n",
      "sys/fs/cgroup/ren.slice/ren-tools.slice/run-1.scope/memory.max": "max\n",
      "sys/fs/cgroup/ren.slice/ren-tools.slice/memory.max": `${5569 * mebibyte}\n`,
      "sys/fs/cgroup/ren.slice/ren-tools.slice/memory.current": `${5200 * mebibyte}\n`,
      "sys/fs/cgroup/ren.slice/ren-tools.slice/memory.stat": `anon ${700 * mebibyte}\nfile ${4500 * mebibyte}\ninactive_file ${4000 * mebibyte}\n`,
    }
    yield* Effect.promise(() =>
      Promise.all([
        mkdir(join(root, "proc/self"), { recursive: true }),
        mkdir(join(slice, "run-1.scope"), { recursive: true }),
      ]),
    )
    yield* Effect.promise(() =>
      Promise.all(Object.entries(files).map((entry) => writeFile(join(root, entry[0]), entry[1]))),
    )
    expect(yield* SandboxMemory.usage(root)).toEqual({ usedBytes: 1200 * mebibyte, limitBytes: 5569 * mebibyte })
  }),
)
