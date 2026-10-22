export * as BunBrain from "./bun-brain.js"

import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Brain } from "@ren/schema/brain"

export interface Instance {
  readonly url: string
  readonly brain: Brain.ID
  readonly home: string
  readonly start: () => Promise<void>
  readonly kill: (signal?: NodeJS.Signals) => Promise<void>
  readonly logs: () => Promise<string>
  readonly dispose: () => Promise<void>
}

const entry = path.resolve(import.meta.dir, "../../src/bun.ts")
const startup = 60_000

const freePort = async () => {
  const socket = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = socket.port ?? 0
  await socket.stop(true)
  return port
}

export const make = async (
  vars: Readonly<Record<string, string>>,
  options: { readonly brain: Brain.ID; readonly generation?: number },
): Promise<Instance> => {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ren-bun-brain-")))
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const state: { child: ReturnType<typeof Bun.spawn> | undefined; output: string } = { child: undefined, output: "" }
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    for await (const chunk of stream) state.output += decoder.decode(chunk, { stream: true })
  }
  const ready = async (deadline: number): Promise<void> => {
    const response = await fetch(`${url}/ren/state`, { signal: AbortSignal.timeout(1_000) }).catch(() => undefined)
    if (response && response.status !== 503) return
    if (state.child?.exitCode !== null && state.child?.exitCode !== undefined)
      throw new Error(`The Bun brain exited before it served a request\n${state.output.slice(-4000)}`)
    if (Date.now() > deadline) throw new Error(`The Bun brain did not answer at ${url} within ${startup} ms`)
    await Bun.sleep(50)
    return ready(deadline)
  }
  const start = async () => {
    const child = Bun.spawn([process.execPath, entry], {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        TMPDIR: process.env.TMPDIR,
        REN_HOME: home,
        PORT: String(port),
        REN_BRAIN_ID: options.brain,
        REN_BRAIN_GENERATION: String(options.generation ?? 1),
        ...vars,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    state.child = child
    void drain(child.stdout)
    void drain(child.stderr)
    await ready(Date.now() + startup)
  }
  const kill = async (signal: NodeJS.Signals = "SIGKILL") => {
    if (!state.child) return
    state.child.kill(signal)
    await state.child.exited
    state.child = undefined
  }
  await start()
  return {
    url,
    brain: options.brain,
    home,
    start,
    kill,
    logs: () => Promise.resolve(state.output),
    dispose: async () => {
      await kill()
      await fs.rm(home, { recursive: true, force: true })
    },
  }
}
