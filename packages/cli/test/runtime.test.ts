import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ApiError } from "@renai-labs/sdk/effect"
import { Runtime } from "../src/runtime.js"
import { Output } from "../src/services/output.js"

test("an API error keeps its tag and fields; anything else the CLI reports is a CliError", () => {
  expect(Runtime.describe(new ApiError.NotFoundError({ message: "No such space.", resource: "space" }))).toEqual({
    type: "NotFoundError",
    message: "No such space.",
    resource: "space",
  })
  expect(Runtime.describe(new Output.Failure({ message: "Apply cancelled." }))).toEqual({
    type: "CliError",
    message: "Apply cancelled.",
  })
  expect(Runtime.describe(new Error("Timed out waiting for sign-in."))).toEqual({
    type: "CliError",
    message: "Timed out waiting for sign-in.",
  })
})

test("interrupting as soon as a command starts releases its scope without an error report", async () => {
  const root = await mkdtemp(join(tmpdir(), "ren2-runtime-"))
  const released = join(root, "released")
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./lib/runtime.ts", import.meta.url)), released], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = child.stdout
  const reader = stdout.getReader()
  const ready = await reader.read()
  expect(new TextDecoder().decode(ready.value)).toBe("ready\n")
  reader.releaseLock()
  child.kill("SIGINT")

  const result = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(result[0]).toBe(130)
  expect(result[1]).toBe("")
  expect(await Bun.file(released).text()).toBe("released")
  await rm(root, { recursive: true })
})
