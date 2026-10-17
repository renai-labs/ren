export * as Wrangler from "./wrangler.js"

import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Celld } from "./celld.js"

const cell = path.resolve(import.meta.dir, "../..")

export interface Instance extends Celld.Instance {
  readonly restart: (vars: Readonly<Record<string, string>>, main?: string) => Promise<void>
  readonly crash: () => Promise<void>
  readonly pid: () => number | undefined
}

export const make = async (vars: Readonly<Record<string, string>>, main = "src/worker.ts"): Promise<Instance> => {
  const project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ren-wrangler-")))
  const config = await Bun.file(path.join(cell, "wrangler.jsonc")).text()
  const configure = async (nextVars: Readonly<Record<string, string>>, nextMain: string) => {
    await Bun.write(
      path.join(project, "wrangler.jsonc"),
      config.replace('"src/worker.ts"', JSON.stringify(path.join(cell, nextMain))),
    )
    await Bun.write(
      path.join(project, ".dev.vars"),
      Object.entries(nextVars)
        .map((entry) => `${entry[0]}='${entry[1]}'`)
        .join("\n"),
    )
  }
  await configure(vars, main)
  const socket = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const url = `http://127.0.0.1:${socket.port}`
  const port = String(socket.port)
  await socket.stop(true)
  const state: { child: ReturnType<typeof Bun.spawn> | undefined; output: string; drained: Promise<void> | undefined } =
    {
      child: undefined,
      output: "",
      drained: undefined,
    }
  const kill = async () => {
    if (!state.child) return
    state.child.kill("SIGTERM")
    await state.child.exited
    await state.drained
    state.child = undefined
  }
  const dispose = async () => {
    await kill()
    await fs.rm(project, { recursive: true, force: true })
  }
  const start = async () => {
    state.output = ""
    const child = Bun.spawn(
      [
        "node",
        path.join(cell, "node_modules/wrangler/wrangler-dist/cli.js"),
        "dev",
        "--config",
        path.join(project, "wrangler.jsonc"),
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        port,
        "--inspector-port",
        "0",
        "--persist-to",
        path.join(project, "state"),
      ],
      {
        cwd: cell,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    state.child = child
    state.drained = Promise.all(
      [child.stdout, child.stderr].map(async (stream) => {
        await stream.pipeTo(
          new WritableStream({
            write: (chunk) => {
              state.output += new TextDecoder().decode(chunk)
            },
          }),
        )
      }),
    ).then(() => undefined)
    const deadline = Date.now() + 120_000
    const ready = async (): Promise<void> => {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => undefined)
      if (response?.status === 401) return
      if (response && response.status >= 500) {
        state.output += await response.text()
        await dispose()
        throw new Error(`Wrangler failed to serve ${url}\n${state.output}`)
      }
      if (child.exitCode !== null || Date.now() >= deadline) {
        await dispose()
        throw new Error(`Wrangler failed to serve ${url}\n${state.output}`)
      }
      await Bun.sleep(100)
      return ready()
    }
    await ready()
  }
  await start()
  return {
    url,
    pid: () => state.child?.pid,
    start,
    kill,
    logs: () => Promise.resolve(state.output),
    dispose,
    restart: async (nextVars, nextMain = main) => {
      await kill()
      await configure(nextVars, nextMain)
      await start()
    },
    crash: async () => {
      const child = state.child
      if (!child) return
      const descendants = (pid: number): ReadonlyArray<number> => {
        const children = new TextDecoder()
          .decode(Bun.spawnSync(["pgrep", "-P", String(pid)]).stdout)
          .split("\n")
          .filter(Boolean)
          .map(Number)
        return [...children, ...children.flatMap(descendants)]
      }
      for (const pid of [child.pid, ...descendants(child.pid)]) Bun.spawnSync(["kill", "-KILL", String(pid)])
      await child.exited
      await state.drained
      state.child = undefined
    },
  }
}
