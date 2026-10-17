import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

describe("ren", () => {
  test("fails on an unknown command", async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("../src/index.ts", import.meta.url)), "nope"], {
      stdout: "ignore",
      stderr: "pipe",
    })
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

    expect(code).toBe(1)
    expect(stderr).toContain("Unknown command: nope")
  })
})
