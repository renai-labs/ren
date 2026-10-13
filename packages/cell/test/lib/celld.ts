export * as Celld from "./celld.js"

import fs from "fs/promises"
import os from "os"
import path from "path"

export interface Instance {
  readonly url: string
  readonly start: () => Promise<void>
  readonly kill: () => Promise<void>
  readonly logs: () => Promise<string>
  readonly dispose: () => Promise<void>
}

const cell = path.resolve(import.meta.dir, "../..")
const repository = path.resolve(cell, "../..")
const startup = 120_000

const docker = async (args: ReadonlyArray<string>) => {
  const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" })
  const output = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (output[2] !== 0) throw new Error(`docker ${args.join(" ")} exited with ${output[2]}\n${output[1]}`)
  return { stdout: output[0].trim(), stderr: output[1].trim() }
}

const image = { build: undefined as Promise<string> | undefined }

const build = () =>
  (image.build ??= docker(["build", "--quiet", path.join(cell, "docker")]).then((result) => result.stdout))

const ready = async (url: string, container: string, deadline: number): Promise<void> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(1_000) }).catch(() => undefined)
  if (response) return
  const running = await docker(["inspect", "--format", "{{.State.Running}}", container])
  if (running.stdout !== "true") {
    const logs = await docker(["logs", container])
    throw new Error(`celld exited before it served a request\n${logs.stdout}\n${logs.stderr}`)
  }
  if (Date.now() > deadline) throw new Error(`celld did not answer at ${url} within ${startup} ms`)
  await Bun.sleep(100)
  return ready(url, container, deadline)
}

export const make = async (vars: Readonly<Record<string, string>>, main = "src/worker.ts"): Promise<Instance> => {
  const project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ren-celld-")))
  const config = await Bun.file(path.join(cell, "wrangler.jsonc")).text()
  if (!config.includes('"main": "src/worker.ts"'))
    throw new Error("wrangler.jsonc no longer sets main to src/worker.ts")
  // oxlint-disable-next-line ren/no-comments -- celld keeps its state and reads .dev.vars beside the config, and follows a linked config to its real folder, so each instance gets a copy. The repository is mounted at its host path so the src and test links and node_modules links resolve in the container.
  await Bun.write(path.join(project, "wrangler.jsonc"), config.replace('"main": "src/worker.ts"', `"main": "${main}"`))
  await fs.symlink(path.join(cell, "src"), path.join(project, "src"))
  await fs.symlink(path.join(cell, "test"), path.join(project, "test"))
  await Bun.write(
    path.join(project, ".dev.vars"),
    Object.entries(vars)
      .map((entry) => `${entry[0]}='${entry[1]}'`)
      .join("\n"),
  )
  const state = { container: "", port: "" }

  const start = async () => {
    const run = await docker([
      "run",
      "--detach",
      "--label",
      "ren.test=cell",
      "--add-host",
      "host.docker.internal:host-gateway",
      "--publish",
      `127.0.0.1:${state.port}:9876`,
      "--volume",
      `${repository}:${repository}:ro`,
      "--volume",
      `${project}:${project}`,
      await build(),
      "dev",
      project,
      "--host",
      "0.0.0.0",
      "--no-watch",
    ])
    state.container = run.stdout
    const published = await docker(["port", state.container, "9876/tcp"])
    const port = /:(\d+)$/m.exec(published.stdout)?.[1]
    if (!port) throw new Error(`docker published no port for celld: ${published.stdout}`)
    state.port = port
    await ready(`http://127.0.0.1:${state.port}`, state.container, Date.now() + startup)
  }

  const kill = async () => {
    if (!state.container) return
    await docker(["rm", "--force", state.container])
    state.container = ""
  }

  await start()

  return {
    url: `http://127.0.0.1:${state.port}`,
    start,
    kill,
    logs: () => docker(["logs", state.container]).then((result) => `${result.stdout}\n${result.stderr}`),
    dispose: async () => {
      await kill()
      await fs.rm(project, { recursive: true, force: true })
    },
  }
}
