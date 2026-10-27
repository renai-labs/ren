import { expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("../..", import.meta.url))

export const asset = `ren2-${process.platform}-${process.arch}`

export const makeReleases = async () => {
  const root = await mkdtemp(join(tmpdir(), "ren2-releases-"))
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const file = Bun.file(join(root, new URL(request.url).pathname))
      return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 })
    },
  })
  return {
    root,
    host: server.url.origin,
    file: (version: string, name = asset) => join(root, "ren2/releases", version, name),
    build: async (version: string) => {
      const build = Bun.spawn(
        [process.execPath, "script/build.ts", "--version", version, "--outdir", join(root, "ren2")],
        {
          cwd: cli,
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const errors = await new Response(build.stderr).text()
      expect(await build.exited, errors).toBe(0)
    },
    latest: (version: string) => Bun.write(join(root, "ren2/latest.txt"), `${version}\n`),
    dispose: async () => {
      await server.stop(true)
      await rm(root, { recursive: true, force: true })
    },
  }
}

export const run = async (command: ReadonlyArray<string>, home: string, env: Record<string, string>) => {
  const child = Bun.spawn([...command], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      SHELL: "/bin/zsh",
      ZDOTDIR: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      REN_URL: "not-a-url",
      ...env,
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
