import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const created: Array<string> = []
const keys: Array<{ id: string; secret: string; createdAt: string }> = []

// oxlint-disable-next-line ren/no-comments -- A stand-in for Ren's ren-inference routes: one member's keys and a plan that sets OpenCode's provider.
const ren = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const url = new URL(request.url)
    const route = `${request.method} ${url.pathname}`
    const baseUrl = url.origin
    if (route === "GET /v1/models" && url.searchParams.get("client_version") === "0.166.0")
      return Response.json({ models: [{ slug: "openai/gpt-6-luna" }, { slug: "anthropic/claude-opus-5-5" }] })
    const present = (key: { id: string; secret: string; createdAt: string }) => ({
      id: key.id,
      name: "ren2 on test",
      prefix: key.secret.slice(0, 12),
      status: "active",
      owner: { memberId: "mem_me", name: "Ada" },
      expiresAt: null,
      lastUsedAt: null,
      createdAt: key.createdAt,
      canRevoke: true,
    })
    if (route === "GET /ren-inference/keys") return Response.json({ baseUrl, keys: keys.map(present) })
    if (route === "POST /ren-inference/keys") {
      const key = {
        id: `ifk_${keys.length + 1}`,
        secret: `sk-ren-secret-${keys.length + 1}`,
        createdAt: "2026-11-12T00:00:00.000Z",
      }
      keys.push(key)
      created.push(key.id)
      return Response.json({ ...present(key), secret: key.secret, baseUrl })
    }
    const secret = keys.find((key) => route === `GET /ren-inference/keys/${key.id}/secret`)
    if (secret) return Response.json({ secret: secret.secret, baseUrl })
    const plan = route === "POST /ren-inference/harness-plans" ? await request.json() : undefined
    if (plan?.harnessId === "codex")
      return Response.json({
        schemaVersion: 1,
        setupPlan: {
          operations: [
            {
              kind: "replace-ren-owned-file",
              target: { kind: "codex-profile", profileName: "ren" },
              format: "toml",
              value: { model: "openai/gpt-6-luna", model_provider: "ren" },
              description: "Ren’s Codex profile",
              containsSecret: false,
            },
          ],
          verificationSteps: [],
        },
        warnings: [],
      })
    if (plan)
      return Response.json({
        schemaVersion: 1,
        setupPlan: {
          operations: [
            {
              kind: "set-object-path",
              target: { kind: "opencode-user-configuration" },
              keyPath: ["provider", "ren"],
              value: { options: { baseURL: "https://llm.test/v1", apiKey: "${REN_INFERENCE_KEY}" } },
              description: "Adds Ren as a provider",
              containsSecret: true,
            },
          ],
          verificationSteps: [{ kind: "models-reachable" }],
        },
        warnings: [],
      })
    return Response.json({ _tag: "NotFoundError", message: "not found" }, { status: 404 })
  },
})

afterAll(() => ren.stop(true))

const home = await mkdtemp(join(tmpdir(), "ren2-home-"))
const config = join(home, ".config")
const opencode = join(home, ".config/opencode/opencode.jsonc")
const original = '{\n  // my own settings\n  "model": "mine/big"\n}\n'
await Bun.write(opencode, original)
await Bun.write(
  join(config, "ren2/credentials.json"),
  JSON.stringify({
    [`http://127.0.0.1:${ren.port}`]: { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 },
  }),
)

// oxlint-disable-next-line ren/no-comments -- A `codex` on PATH that reports a version, so setup asks the base URL for Codex's model list.
await Bun.write(join(home, "bin/codex"), '#!/bin/sh\necho "codex-cli 0.166.0"\n', { mode: 0o755 })

const ren2 = async (args: ReadonlyArray<string>) => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("../src/index.ts", import.meta.url)), ...args], {
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: config,
      REN_URL: `http://127.0.0.1:${ren.port}`,
      PATH: `${join(home, "bin")}:${process.env.PATH}`,
    },
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

describe("ren2 inference setup", () => {
  test("writes the harness file and inference.json, reuses the key on a second run, and --undo restores the file", async () => {
    const first = await ren2(["inference", "setup", "opencode", "--yes", "--output", "json"])
    expect(first.code).toBe(0)
    const written = await Bun.file(opencode).text()
    expect(written).toContain("// my own settings")
    expect(written).toContain('"apiKey": "sk-ren-secret-1"')
    expect(first.stderr).not.toContain("sk-ren-secret-1")
    expect(await Bun.file(join(config, "ren2/inference.json")).json()).toEqual({
      harnesses: [{ harnessId: "opencode", keyId: "ifk_1", withOptional: false, time: expect.any(String) }],
    })

    const second = await ren2(["inference", "setup", "opencode", "--yes", "--output", "json"])
    expect(second.code).toBe(0)
    expect(created).toEqual(["ifk_1"])
    expect(await Bun.file(opencode).text()).toBe(written)

    const undone = await ren2(["inference", "setup", "--undo", "--yes", "--output", "json"])
    expect(undone.code).toBe(0)
    expect(await Bun.file(opencode).text()).toBe(original)
  })

  test("writes Codex's model list from the base URL and points Ren's profile at it", async () => {
    const result = await ren2(["inference", "setup", "codex", "--yes", "--output", "json"])
    expect(result.code).toBe(0)
    expect(await Bun.file(join(home, ".codex/ren-models.json")).json()).toEqual({
      models: [{ slug: "openai/gpt-6-luna" }, { slug: "anthropic/claude-opus-5-5" }],
    })
    expect(await Bun.file(join(home, ".codex/ren.config.toml")).text()).toBe(
      'model = "openai/gpt-6-luna"\nmodel_provider = "ren"\nmodel_catalog_json = "~/.codex/ren-models.json"\n',
    )
  })
})
