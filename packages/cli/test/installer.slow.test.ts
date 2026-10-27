import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("..", import.meta.url))
const version = "0.0.0-test"
const asset = `ren2-${process.platform}-${process.arch}`
const root = await mkdtemp(join(tmpdir(), "ren2-install-"))
const releases = join(root, "ren2/releases")
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const path = new URL(request.url).pathname
    const file = Bun.file(join(root, path))
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 })
  },
})

const run = async (command: ReadonlyArray<string>, home: string) => {
  const child = Bun.spawn([...command], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      SHELL: "/bin/zsh",
      ZDOTDIR: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      REN2_HOST_URL: server.url.origin,
      REN_URL: "not-a-url",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    code: await child.exited,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  }
}

const install = (home: string, args: ReadonlyArray<string> = []) =>
  run(
    [
      "/bin/bash",
      "-o",
      "pipefail",
      "-c",
      'curl -fsSL "$REN2_HOST_URL/ren2/install.sh" | bash -s -- "$@"',
      "install",
      ...args,
    ],
    home,
  )

beforeAll(async () => {
  const build = Bun.spawn([process.execPath, "script/build.ts", "--version", version, "--outdir", join(root, "ren2")], {
    cwd: cli,
    stdout: "pipe",
    stderr: "pipe",
  })
  const errors = await new Response(build.stderr).text()
  expect(await build.exited, errors).toBe(0)
  await Bun.write(join(root, "ren2/latest.txt"), `${version}\n`)
}, 120_000)

afterAll(async () => {
  await server.stop(true)
  await rm(root, { recursive: true, force: true })
})

describe("curl installer", () => {
  test("installs a standalone CLI beside ren and adds PATH only once", async () => {
    const home = await mkdtemp(join(root, "home-"))
    const legacy = join(home, ".ren/bin/ren")
    const credentials = join(home, ".config/ren/auth.json")
    await Bun.write(legacy, "legacy executable")
    await Bun.write(credentials, "legacy credentials")
    const first = await install(home)
    expect(first.code, first.stderr).toBe(0)
    const second = await install(home)
    expect(second.code, second.stderr).toBe(0)
    expect(await Bun.file(join(home, ".zshrc")).text()).toBe('\nexport PATH="$HOME/.ren2/bin:$PATH"\n')
    expect(await Bun.file(legacy).text()).toBe("legacy executable")
    expect(await Bun.file(credentials).text()).toBe("legacy credentials")

    const binary = join(home, ".ren2/bin/ren2")
    expect(await run([binary, "--version"], home)).toEqual({ code: 0, stdout: `ren2 v${version}\n`, stderr: "" })
    const help = await run([binary, "infra", "apply", "--help"], home)
    expect(help.code).toBe(0)
    expect(help.stdout).toContain("--plan")
    await Bun.write(join(home, ".ren/org.yaml"), "settings: {}\n")
    expect(await run([binary, "infra", "validate"], home)).toEqual({
      code: 0,
      stdout: '{\n  "valid": true\n}\n',
      stderr: "",
    })
  })

  test("pins a release without changing shell configuration", async () => {
    const home = await mkdtemp(join(root, "home-"))
    const result = await install(home, ["--version", version, "--no-modify-path", "--no-init"])
    expect(result.code, result.stderr).toBe(0)
    expect(await Bun.file(join(home, ".zshrc")).exists()).toBe(false)
    expect(result.stdout).toContain(".ren2/bin")
  })

  test("keeps the installed executable when a release is missing, corrupt or mislabeled", async () => {
    const home = await mkdtemp(join(root, "home-"))
    expect((await install(home, ["--no-modify-path"])).code).toBe(0)
    const missing = await install(home, ["--version", "0.0.1", "--no-modify-path"])
    expect(missing.code).not.toBe(0)

    await Bun.write(join(releases, "0.0.2", asset), "corrupt binary")
    await Bun.write(join(releases, "0.0.2", `${asset}.sha256`), Bun.file(join(releases, version, `${asset}.sha256`)))
    const corrupt = await install(home, ["--version", "0.0.2", "--no-modify-path"])
    expect(corrupt.code).not.toBe(0)
    expect(corrupt.stderr).toContain("Checksum mismatch")
    await Bun.write(join(releases, "0.0.3", asset), Bun.file(join(releases, version, asset)))
    await Bun.write(join(releases, "0.0.3", `${asset}.sha256`), Bun.file(join(releases, version, `${asset}.sha256`)))
    const mislabeled = await install(home, ["--version", "0.0.3", "--no-modify-path"])
    expect(mislabeled.code).not.toBe(0)
    expect(mislabeled.stderr).toContain("wrong version")
    expect(await run([join(home, ".ren2/bin/ren2"), "--version"], home)).toEqual({
      code: 0,
      stdout: `ren2 v${version}\n`,
      stderr: "",
    })
  })
})
