import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ApiError } from "@renai-labs/sdk/effect"
import { Schema } from "effect"
import { Runtime } from "../src/runtime.js"
import { Output } from "../src/services/output.js"
import { items } from "./lib/large.js"

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

test("a result or an error larger than a pipe's buffer arrives whole in each format", async () => {
  const large = async (args: ReadonlyArray<string>) => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./lib/large.ts", import.meta.url)), ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const result = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { code: result[0], stdout: result[1], stderr: result[2] }
  }
  const json = await large(["--output", "json"])
  const pretty = await large(["--output", "pretty"])
  const failedJson = await large(["--fail", "--output", "json"])
  const failedPretty = await large(["--fail", "--output", "pretty"])

  expect(json.code).toBe(0)
  expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(json.stdout)).toEqual(items)
  expect(pretty).toEqual({ code: 0, stdout: `${items.join("\n")}\n`, stderr: "" })
  expect(failedJson.code).toBe(1)
  expect(
    Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.Struct({ error: Schema.Struct({ message: Schema.String }) })),
    )(failedJson.stderr).error.message,
  ).toBe(items.join(" "))
  expect(failedPretty).toEqual({ code: 1, stdout: "", stderr: `${items.join(" ")}\n` })
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
