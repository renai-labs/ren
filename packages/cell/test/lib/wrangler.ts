export * as Wrangler from "./wrangler.js"

import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Celld } from "./celld.js"

const cell = path.resolve(import.meta.dir, "../..")

export const make = async (vars: Readonly<Record<string, string>>, main = "src/worker.ts"): Promise<Celld.Instance> => {
  const project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ren-wrangler-")))
  const config = await Bun.file(path.join(cell, "wrangler.jsonc")).text()
  await Bun.write(
    path.join(project, "wrangler.jsonc"),
    config.replace('"src/worker.ts"', JSON.stringify(path.join(cell, main))),
  )
  await Bun.write(
    path.join(project, ".dev.vars"),
    Object.entries(vars)
      .map((entry) => `${entry[0]}='${entry[1]}'`)
      .join("\n"),
  )
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
  return { url, start, kill, logs: () => Promise.resolve(state.output), dispose }
}
