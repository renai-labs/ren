import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"

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

const failure = (stderr: string) =>
  Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        error: Schema.StructWithRest(Schema.Struct({ type: Schema.String, message: Schema.String }), [
          Schema.Record(Schema.String, Schema.Unknown),
        ]),
      }),
    ),
  )(stderr).error

describe("ren2", () => {
  test("a usage error exits 2 with one JSON error when piped, and with help and the problem in a terminal format", async () => {
    const piped = await ren(["nope"])
    const pretty = await ren(["nope", "--output", "pretty"])

    expect(piped.code).toBe(2)
    expect(piped.stdout).toBe("")
    expect(failure(piped.stderr)).toMatchObject({ type: "UsageError", message: expect.stringContaining("nope") })
    expect(pretty.code).toBe(2)
    expect(pretty.stderr).toContain("USAGE")
    expect(pretty.stderr).toContain("nope")
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

  test("without a subcommand, a terminal shows only the help, led by the description", async () => {
    const result = await ren(["--output", "pretty"])

    expect(result.code).toBe(2)
    expect(result.stderr).toStartWith("Ren CLI\n\nUSAGE\n")
    expect(result.stderr).not.toContain("DESCRIPTION")
    expect(result.stderr).not.toContain("Choose a subcommand")
  })

  test("prints a shell completion script that covers generated resources", async () => {
    const result = await ren(["--completions", "zsh"])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("#compdef ren2")
    expect(result.stdout).toContain("space")
    expect(result.stderr).toBe("")
  })

  test("rejects extra arguments and flags outside their command before executing", async () => {
    const root = await folder({ "org.yaml": "settings: {}\n" })
    const extra = await ren(["infra", "validate", root, "extra"])
    const flag = await ren(["infra", "validate", root, "--allow-archive"])

    expect(extra.code).toBe(2)
    expect(extra.stdout).toBe("")
    expect(extra.stderr).toContain("extra")
    expect(flag.code).toBe(2)
    expect(flag.stdout).toBe("")
    expect(flag.stderr).toContain("--allow-archive")
  })

  test("an error is reported once on stderr, as JSON when piped and as its message in pretty format", async () => {
    const piped = await ren(["health"])
    const pretty = await ren(["--output", "pretty", "health"])

    expect(piped).toEqual({
      code: 1,
      stdout: "",
      stderr: '{"error":{"type":"CliError","message":"Invalid REN_URL: not-a-url"}}\n',
    })
    expect(pretty).toEqual({ code: 1, stdout: "", stderr: "Invalid REN_URL: not-a-url\n" })
  })

  test("says which server it could not reach", async () => {
    const result = await ren(["health", "--output", "pretty"], { env: { REN_URL: "http://127.0.0.1:9" } })

    expect(result.code).toBe(1)
    expect(result.stderr).toBe("Could not reach http://127.0.0.1:9.\n")
  })

  test("uses stored credentials only for the server that issued them", async () => {
    const config = await folder({
      "ren2/credentials.json": JSON.stringify({
        "https://ren.example": { accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 3_600_000 },
      }),
    })

    const result = await ren(["whoami"], { env: { XDG_CONFIG_HOME: config, REN_URL: "http://127.0.0.1:9" } })

    expect(result.code).toBe(1)
    expect(failure(result.stderr)).toEqual({
      type: "CliError",
      message: "Not logged in to http://127.0.0.1:9. Run ren2 login.",
    })
  })

  test("infra validate reads .ren by default and prints the result in the chosen format", async () => {
    const root = await folder({
      ".ren/org.yaml": "settings: {}\n",
      ".ren/spaces/engineering/space.yaml": "name: Engineering\n",
    })

    const piped = await ren(["infra", "validate"], { cwd: root })
    const pretty = await ren(["infra", "validate", "--output", "pretty"], { cwd: root })

    expect(piped).toEqual({ code: 0, stdout: '{\n  "valid": true\n}\n', stderr: "" })
    expect(pretty).toEqual({ code: 0, stdout: "The spec is valid.\n", stderr: "" })
  })

  test("infra validate fails with each problem, structured in JSON", async () => {
    const root = await folder({ "org.yaml": "settings: {}\n", "spaces/engineering/space.yaml": "{}\n" })

    const piped = await ren(["infra", "validate", root])
    const pretty = await ren(["infra", "validate", root, "--output=pretty"])

    expect(piped.code).toBe(1)
    expect(failure(piped.stderr)).toEqual({
      type: "CliError",
      message: "spaces/engineering/space.yaml: name: Missing key",
      problems: [{ path: "spaces/engineering/space.yaml", field: "name", message: "Missing key" }],
    })
    expect(pretty).toEqual({ code: 1, stdout: "", stderr: "spaces/engineering/space.yaml: name: Missing key\n" })
  })
})
