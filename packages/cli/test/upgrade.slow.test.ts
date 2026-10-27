import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readdir } from "node:fs/promises"
import { join } from "node:path"
import { asset, makeReleases, run } from "./lib/releases.js"

const releases = await makeReleases()

const exec = (command: ReadonlyArray<string>, home: string) => run(command, home, { REN2_HOST_URL: releases.host })

const installed = async (version: string) => {
  const home = await mkdtemp(join(releases.root, "home-"))
  const binary = join(home, ".ren2/bin/ren2")
  await Bun.write(binary, Bun.file(releases.file(version)))
  await chmod(binary, 0o755)
  return { home, binary }
}

beforeAll(async () => {
  await releases.build("0.0.1")
  await releases.build("0.0.2")
  await releases.latest("0.0.2")
}, 240_000)

afterAll(() => releases.dispose())

describe("ren2 upgrade", () => {
  test("replaces the executable with the latest release, then says it is up to date", async () => {
    const cli = await installed("0.0.1")

    const upgraded = await exec([cli.binary, "upgrade", "--output", "pretty"], cli.home)
    expect(upgraded).toEqual({ code: 0, stdout: "Upgraded ren2 v0.0.1 → v0.0.2.\n", stderr: "" })
    expect((await exec([cli.binary, "--version"], cli.home)).stdout).toBe("ren2 v0.0.2\n")
    expect(await exec([cli.binary, "upgrade", "--output", "pretty"], cli.home)).toEqual({
      code: 0,
      stdout: "ren2 v0.0.2 is up to date.\n",
      stderr: "",
    })
    expect(await exec([cli.binary, "upgrade", "0.0.1", "--output", "pretty"], cli.home)).toEqual({
      code: 0,
      stdout: "Upgraded ren2 v0.0.2 → v0.0.1.\n",
      stderr: "",
    })
  })

  test("keeps the executable when a release is corrupt or reports another version", async () => {
    const cli = await installed("0.0.1")
    await Bun.write(releases.file("0.0.3"), "corrupt binary")
    await Bun.write(releases.file("0.0.3", `${asset}.sha256`), Bun.file(releases.file("0.0.2", `${asset}.sha256`)))
    await Bun.write(releases.file("0.0.4"), Bun.file(releases.file("0.0.2")))
    await Bun.write(releases.file("0.0.4", `${asset}.sha256`), Bun.file(releases.file("0.0.2", `${asset}.sha256`)))

    const corrupt = await exec([cli.binary, "upgrade", "0.0.3", "--output", "pretty"], cli.home)
    const mislabeled = await exec([cli.binary, "upgrade", "0.0.4", "--output", "pretty"], cli.home)

    expect(corrupt).toEqual({ code: 1, stdout: "", stderr: "Checksum mismatch.\n" })
    expect(mislabeled).toEqual({ code: 1, stdout: "", stderr: "The downloaded ren2 reports the wrong version.\n" })
    expect((await exec([cli.binary, "--version"], cli.home)).stdout).toBe("ren2 v0.0.1\n")
    expect(await readdir(join(cli.home, ".ren2/bin"))).toEqual(["ren2"])
  })
})
