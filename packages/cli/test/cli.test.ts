import { describe, expect, test } from "bun:test"

const run = async (...args: string[]) => {
  const child = Bun.spawn([process.execPath, new URL("../src/index.ts", import.meta.url).pathname, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

describe("ren", () => {
  test("prints usage without a command", async () => {
    const result = await run()
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Usage: ren")
  })

  test("fails on an unknown command", async () => {
    const result = await run("nope")
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Unknown command: nope")
  })
})
