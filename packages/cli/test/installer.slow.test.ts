import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { asset, makeReleases, run } from "./lib/releases.js"

const version = "0.0.0-test"
const releases = await makeReleases()
const root = releases.root

const exec = (command: ReadonlyArray<string>, home: string) => run(command, home, { REN2_HOST_URL: releases.host })

const install = (home: string, args: ReadonlyArray<string> = []) =>
  exec(
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
  await releases.build(version)
  await releases.latest(version)
}, 120_000)

afterAll(() => releases.dispose())

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
    expect(await exec([binary, "--version"], home)).toEqual({ code: 0, stdout: `ren2 v${version}\n`, stderr: "" })
    const help = await exec([binary, "infra", "apply", "--help"], home)
    expect(help.code).toBe(0)
    expect(help.stdout).toContain("--plan")
    await Bun.write(join(home, ".ren/org.yaml"), "settings: {}\n")
    expect(await exec([binary, "infra", "validate"], home)).toEqual({
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

    await Bun.write(releases.file("0.0.2"), "corrupt binary")
    await Bun.write(releases.file("0.0.2", `${asset}.sha256`), Bun.file(releases.file(version, `${asset}.sha256`)))
    const corrupt = await install(home, ["--version", "0.0.2", "--no-modify-path"])
    expect(corrupt.code).not.toBe(0)
    expect(corrupt.stderr).toContain("Checksum mismatch")
    await Bun.write(releases.file("0.0.3"), Bun.file(releases.file(version)))
    await Bun.write(releases.file("0.0.3", `${asset}.sha256`), Bun.file(releases.file(version, `${asset}.sha256`)))
    const mislabeled = await install(home, ["--version", "0.0.3", "--no-modify-path"])
    expect(mislabeled.code).not.toBe(0)
    expect(mislabeled.stderr).toContain("wrong version")
    expect(await exec([join(home, ".ren2/bin/ren2"), "--version"], home)).toEqual({
      code: 0,
      stdout: `ren2 v${version}\n`,
      stderr: "",
    })
  })
})
