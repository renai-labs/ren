import { expect } from "bun:test"
import { FileNotFoundError, maxFileBytes } from "@ren/brain-api/executor-api"
import { EnvironmentAccess } from "@ren/brain/environment-access"
import { Environments } from "@ren/brain/environments"
import { Executor } from "@ren/executor/executor"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Machine, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { mkdir, mkdtemp, realpath, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ShellOutput } from "../src/harness/opencode/shell-output.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-shell-output-")))

// oxlint-disable-next-line ren/no-comments -- The sandbox keeps the copied files in memory, so its disk is not the cell's disk.
const sandbox = new Map<string, Uint8Array>()

const separateDisk = Layer.effect(
  Executor.Service,
  Effect.map(Executor.Service, (executor) =>
    Executor.Service.of({
      ...executor,
      mkdir: () => Effect.void,
      write: (path, bytes) => Effect.sync(() => void sandbox.set(path, bytes)),
      stat: (path) => {
        const bytes = sandbox.get(path)
        return bytes
          ? Effect.succeed({ type: "file", sizeBytes: bytes.length, modifiedAtMs: 0 })
          : Effect.fail(new FileNotFoundError({ path }))
      },
    }),
  ),
).pipe(Layer.provide(NodeCompatible.layer))

const it = testEffect(Machine.layer({ environmentId, workspace, executor: separateDisk }))

const root = Session.ID.create()
const helper = Session.ID.create()

const subject = Effect.gen(function* () {
  const access = yield* Machine.access({
    url: yield* Machine.url,
    environmentId,
    brain: Brain.ofSession(root),
    directory: join(workspace, root),
  })
  const environments = Context.get(
    yield* Layer.build(
      Environments.layer.pipe(
        Layer.provide(EnvironmentAccess.layerFixed(new Map([[root, access]]))),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
    Environments.Service,
  )
  return ShellOutput.make(environments, {
    parentOf: (sessionId) => Effect.succeed(sessionId === helper ? Option.some(root) : Option.none()),
  })
})

const cellFile = (bytes: string | number) =>
  Effect.promise(async () => {
    const folder = join(workspace, "cell", "shell", "c9e3672667ce6086")
    await mkdir(folder, { recursive: true })
    const path = join(folder, `sh_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}.out`)
    await writeFile(path, typeof bytes === "string" ? bytes : "")
    if (typeof bytes === "number") await truncate(path, bytes)
    return path
  })

const exists = (path: string) => Effect.promise(() => Bun.file(path).exists())

const notice = (path: string) => `seq output\n\n[showing lines 28001-30000 of 30000; full output saved to ${path}]`

it.live("copies a finished command's full output to the same path on the sandbox, and deletes the cell's copy", () =>
  Effect.gen(function* () {
    const shellOutput = yield* subject
    const path = yield* cellFile("1\n2\n3\n")
    yield* shellOutput.afterCommand(helper, [{ type: "text", text: notice(path) }], false)
    expect(new TextDecoder().decode(sandbox.get(path))).toBe("1\n2\n3\n")
    expect(yield* exists(path)).toBe(false)
  }),
)

it.live(
  "copies a running job's output again as it grows, and deletes the cell's copy once its notice says it finished",
  () =>
    Effect.gen(function* () {
      const shellOutput = yield* subject
      const path = yield* cellFile("partial\n")
      yield* shellOutput.afterCommand(root, `Command moved to the background.\nOutput is streaming to: ${path}`, true)
      expect(new TextDecoder().decode(sandbox.get(path))).toBe("partial\n")
      yield* Effect.promise(() => writeFile(path, "partial\nmore\n"))
      yield* shellOutput.beforeRequest(root, [`Output is streaming to: ${path}`])
      expect([new TextDecoder().decode(sandbox.get(path)), yield* exists(path)]).toEqual(["partial\nmore\n", true])
      yield* Effect.promise(() => writeFile(path, "partial\nmore\nend\n"))
      yield* shellOutput.beforeRequest(root, [
        `Output is streaming to: ${path}`,
        { content: [{ text: `<shell id="sh_1" state="completed" command="job">\n${notice(path)}\n</shell>` }] },
      ])
      expect([new TextDecoder().decode(sandbox.get(path)), yield* exists(path)]).toEqual([
        "partial\nmore\nend\n",
        false,
      ])
    }),
)

it.live("copies only the last 8 MiB of an output that is larger", () =>
  Effect.gen(function* () {
    const shellOutput = yield* subject
    const path = yield* cellFile(maxFileBytes + 10)
    yield* shellOutput.afterCommand(root, notice(path), false)
    expect(sandbox.get(path)?.length).toBe(maxFileBytes)
  }),
)

it.live("leaves text with no output path alone, and an output path that is gone", () =>
  Effect.gen(function* () {
    const shellOutput = yield* subject
    const size = sandbox.size
    yield* shellOutput.afterCommand(root, "done\n", false)
    yield* shellOutput.afterCommand(root, notice(join(workspace, "cell/shell/c9e3672667ce6086/sh_gone.out")), false)
    expect(sandbox.size).toBe(size)
  }),
)
