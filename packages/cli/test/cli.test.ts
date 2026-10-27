import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ren = async (args: ReadonlyArray<string>, options: { cwd?: string } = {}) => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("../src/index.ts", import.meta.url)), ...args], {
    ...options,
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

describe("ren", () => {
  test("fails on an unknown command", async () => {
    const result = await ren(["nope"])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Unknown command: nope")
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
