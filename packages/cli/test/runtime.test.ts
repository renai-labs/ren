import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

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
