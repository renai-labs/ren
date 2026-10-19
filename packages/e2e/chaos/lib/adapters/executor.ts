export * as ExecutorAdapter from "./executor.js"

import { EnvironmentToken } from "@ren/hand-api/environment-token"
import { Signature } from "@ren/hand-api/signature"
import { Sandbox } from "@ren/executor/testing"
import type { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Effect, Schema } from "effect"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Process } from "../process.js"
import { Wait } from "../wait.js"

export const publicKeys = Schema.encodeSync(Signature.PublicKeys)([Sandbox.keys.publicKey])

export const token = (env: Environment.ID, brain: Brain.ID, lifetimeMs = 600_000) =>
  Effect.runPromise(
    EnvironmentToken.sign(Sandbox.keys.privateKey, { env, brain, exp: Math.floor((Date.now() + lifetimeMs) / 1000) }),
  )

export const access = (options: Parameters<typeof Sandbox.access>[0]) => Effect.runPromise(Sandbox.access(options))

export const mainPath = path.resolve(
  path.dirname(Bun.resolveSync("@ren/executor/testing", import.meta.dir)),
  "../../src/main.ts",
)

const logs = path.resolve(import.meta.dir, "../../../.runs", new Date().toISOString().replaceAll(/[:.]/g, "-"))

interface Observation {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface Instance {
  readonly url: () => string
  readonly environmentId: Environment.ID
  readonly workspace: string
  readonly restart: () => Promise<void>
  readonly replace: () => Promise<void>
  readonly freeze: () => Promise<void>
  readonly thaw: () => Promise<void>
  readonly dispose: () => Promise<void>
  readonly observe: (command: ReadonlyArray<string>) => Promise<Observation>
}

export interface Container extends Instance {
  readonly asRoot: (command: ReadonlyArray<string>) => Promise<Observation>
  readonly memoryBytes: () => Promise<number>
}

const run = async (command: ReadonlyArray<string>, cwd?: string): Promise<Observation> => {
  const child = Bun.spawn([...command], { ...(cwd !== undefined && { cwd }), stdout: "pipe", stderr: "pipe" })
  const output = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout: output[0], stderr: output[1], exitCode: output[2] }
}

const ready = (url: string, alive: () => boolean, ms = 30_000) =>
  Wait.until(`the executor at ${url} to serve`, ms, async () => {
    if (!alive()) throw new Error(`the executor at ${url} exited before it served a request`)
    const response = await fetch(`${url}/v1/rpc`, { method: "POST", signal: AbortSignal.timeout(1_000) }).catch(
      () => undefined,
    )
    return response?.status === 401 ? true : undefined
  })

const freePort = async () => {
  const socket = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = socket.port ?? 0
  await socket.stop(true)
  return port
}

export const localProcess = async (options: {
  readonly label: string
  readonly environmentId?: Environment.ID
}): Promise<Instance> => {
  const environmentId = options.environmentId ?? Environment.ID.create()
  const workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "ren-chaos-workspace-")))
  await mkdir(logs, { recursive: true })
  const state: { port: number; starts: number; child: ReturnType<typeof Bun.spawn> | undefined } = {
    port: await freePort(),
    starts: 0,
    child: undefined,
  }
  const halt = async () => {
    const child = state.child
    if (!child) return
    Process.killTree(child.pid)
    await child.exited
    state.child = undefined
  }
  const start = async () => {
    state.starts += 1
    const log = Bun.file(path.join(logs, `executor-${options.label}-${state.starts}.log`))
    const child = Bun.spawn(["bun", mainPath], {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: workspace,
        TMPDIR: os.tmpdir(),
        PORT: String(state.port),
        EXECUTOR_ENVIRONMENT_ID: environmentId,
        EXECUTOR_WORKSPACE: workspace,
        BRAIN_PUBLIC_KEYS: publicKeys,
      },
      stdin: "ignore",
      stdout: log,
      stderr: log,
    })
    state.child = child
    await ready(`http://127.0.0.1:${state.port}`, () => child.exitCode === null)
  }
  const signal = (name: "STOP" | "CONT") => {
    const child = state.child
    if (!child) return Promise.resolve()
    for (const member of [child.pid, ...Process.childPids(child.pid)])
      Bun.spawnSync(["kill", `-${name}`, String(member)], { stderr: "ignore" })
    return Promise.resolve()
  }
  const forget = Process.onInterrupt(halt)
  await start()
  return {
    url: () => `http://127.0.0.1:${state.port}`,
    environmentId,
    workspace,
    restart: async () => {
      await halt()
      await start()
    },
    replace: async () => {
      await halt()
      state.port = await freePort()
      await start()
    },
    freeze: () => signal("STOP"),
    thaw: () => signal("CONT"),
    dispose: async () => {
      forget()
      await halt()
    },
    observe: (command) => run(command, workspace),
  }
}

const docker = async (args: ReadonlyArray<string>) => {
  const output = await run(["docker", ...args])
  if (output.exitCode !== 0) throw new Error(`docker ${args[0] ?? ""} exited with ${output.exitCode}: ${output.stderr}`)
  return output.stdout.trim()
}

const image: { tag: Promise<string> | undefined } = { tag: undefined }

const build = () =>
  (image.tag ??= (async () => {
    const artifact = await mkdtemp(path.join(os.tmpdir(), "ren-chaos-executor-"))
    const bundled = await Bun.build({ entrypoints: [mainPath], target: "bun", outdir: artifact, naming: "executor.js" })
    if (!bundled.success) throw new Error(`bundling the executor failed: ${bundled.logs.map(String).join("\n")}`)
    await Bun.write(
      path.join(artifact, "Dockerfile"),
      Bun.file(path.resolve(import.meta.dir, "../../infra/executor.Dockerfile")),
    )
    const hash = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(path.join(artifact, "executor.js")).bytes())
      .digest("hex")
    const tag = `ren-chaos-executor:${hash.slice(0, 16)}`
    await docker(["build", "--quiet", "--tag", tag, artifact])
    return tag
  })())

export const dockerContainer = async (options: {
  readonly label: string
  readonly environmentId?: Environment.ID
}): Promise<Container> => {
  const environmentId = options.environmentId ?? Environment.ID.create()
  const tag = await build()
  const state = { container: "", url: "" }
  const published = async () => {
    const port = /:(\d+)$/m.exec(await docker(["port", state.container, "4100/tcp"]))?.[1]
    if (!port) throw new Error(`docker published no executor port for ${options.label}`)
    state.url = `http://127.0.0.1:${port}`
    const container = state.container
    await ready(
      state.url,
      () =>
        Bun.spawnSync(["docker", "inspect", "--format", "{{.State.Running}}", container]).stdout.toString().trim() ===
        "true",
      60_000,
    )
  }
  const start = async () => {
    state.container = await docker([
      "run",
      "--detach",
      "--init",
      "--label",
      `ren.chaos=${options.label}`,
      "--publish",
      "127.0.0.1::4100",
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--pids-limit",
      "256",
      "--tmpfs",
      `/workspace:rw,size=${64 * 1024 * 1024},mode=1777`,
      "--env",
      `EXECUTOR_ENVIRONMENT_ID=${environmentId}`,
      "--env",
      `BRAIN_PUBLIC_KEYS=${publicKeys}`,
      tag,
    ])
    await published()
  }
  const remove = async () => {
    if (state.container) await docker(["rm", "--force", state.container])
    state.container = ""
  }
  const forget = Process.onInterrupt(remove)
  await start()
  return {
    url: () => state.url,
    environmentId,
    workspace: "/workspace",
    restart: async () => {
      await docker(["restart", "--time", "0", state.container])
      await published()
    },
    replace: async () => {
      await remove()
      await start()
    },
    freeze: () => docker(["pause", state.container]).then(() => undefined),
    thaw: () => docker(["unpause", state.container]).then(() => undefined),
    dispose: async () => {
      forget()
      await remove()
    },
    observe: (command) => run(["docker", "exec", "--workdir", "/workspace", state.container, ...command]),
    asRoot: (command) => run(["docker", "exec", "--user", "root", state.container, ...command]),
    memoryBytes: async () => {
      const usage = await docker(["stats", "--no-stream", "--format", "{{.MemUsage}}", state.container])
      const found = /^([\d.]+)\s*([KMG]i?B)/.exec(usage.trim())
      const scale: Readonly<Record<string, number>> = {
        KiB: 1024,
        MiB: 1024 ** 2,
        GiB: 1024 ** 3,
        kB: 1e3,
        MB: 1e6,
        GB: 1e9,
      }
      return found ? Number(found[1]) * (scale[found[2] ?? ""] ?? 1) : Number.NaN
    },
  }
}
