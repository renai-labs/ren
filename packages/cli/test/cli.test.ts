import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ren = async (args: ReadonlyArray<string>, options: { cwd?: string; env?: Record<string, string> } = {}) => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("../src/index.ts", import.meta.url)), ...args], {
    ...options,
    env: { ...process.env, REN_URL: "not-a-url", ...options.env },
    stdin: "ignore",
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

const folder = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "ren-cli-"))
  await Promise.all(Object.entries(files).map(([path, content]) => Bun.write(join(root, path), content)))
  return root
}

describe("ren2", () => {
  test("fails on an unknown command", async () => {
    const result = await ren(["nope"])

    expect(result.code).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("nope")
  })

  test("root and nested help work without a connection and use the ren2 name", async () => {
    const root = await ren(["--help"])
    const nested = await ren(["infra", "apply", "--help"])

    expect(root.code).toBe(0)
    expect(root.stdout).toContain("ren2")
    expect(root.stdout).toContain("health")
    expect(root.stderr).toBe("")
    expect(nested.code).toBe(0)
    expect(nested.stdout).toContain("--plan")
    expect(nested.stdout).toContain("--allow-archive")
    expect(nested.stderr).toBe("")
  })

  test("rejects extra arguments and flags outside their command before executing", async () => {
    const root = await folder({ "org.yaml": "settings: {}\n" })
    const extra = await ren(["infra", "validate", root, "extra"])
    const flag = await ren(["infra", "validate", root, "--allow-archive"])

    expect(extra.code).toBe(1)
    expect(extra.stdout).toBe("")
    expect(extra.stderr).toContain("extra")
    expect(flag.code).toBe(1)
    expect(flag.stdout).toBe("")
    expect(flag.stderr).toContain("--allow-archive")
  })

  test("connection errors are reported once on stderr", async () => {
    const result = await ren(["health"])

    expect(result).toEqual({ code: 1, stdout: "", stderr: "Invalid REN_URL: not-a-url\n" })
  })

  test("infra validate reads .ren by default and says when the spec is valid", async () => {
    const root = await folder({
      ".ren/org.yaml": "settings: {}\n",
      ".ren/spaces/engineering/space.yaml": "name: Engineering\n",
    })

    const result = await ren(["infra", "validate"], { cwd: root })

    expect(result).toEqual({ code: 0, stdout: "The spec is valid.\n", stderr: "" })
  })

  test("infra validate prints each problem and fails", async () => {
    const root = await folder({ "org.yaml": "settings: {}\n", "spaces/engineering/space.yaml": "{}\n" })

    const result = await ren(["infra", "validate", root])

    expect(result).toEqual({ code: 1, stdout: "", stderr: "spaces/engineering/space.yaml: name: Missing key\n" })
  })
})
