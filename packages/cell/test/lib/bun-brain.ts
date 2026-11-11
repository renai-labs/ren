export * as BunBrain from "./bun-brain.js"

import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Brain } from "@ren/schema/brain"
import { Schema } from "effect"

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
const Ready = Schema.Struct({ type: Schema.Literal("brain-ready"), port: Schema.Int })

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
  const start = async () => {
    const started = performance.now()
    const ready = Promise.withResolvers<void>()
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
      ipc: (message: unknown) => {
        if (Schema.is(Ready)(message) && message.port === port) ready.resolve()
      },
    })
    state.child = child
    void drain(child.stdout)
    void drain(child.stderr)
    void child.exited.then(() =>
      ready.reject(new Error(`The Bun brain exited before it was ready\n${state.output.slice(-4000)}`)),
    )
    const timeout = setTimeout(
      () =>
        ready.reject(
          new Error(`The Bun brain did not become ready within ${startup} ms\n${state.output.slice(-4000)}`),
        ),
      startup,
    )
    await ready.promise
      .catch(async (error: unknown) => {
        await kill()
        throw error
      })
      .finally(() => {
        clearTimeout(timeout)
        if (process.env.REN_TEST_PROFILE)
          process.stderr.write(
            `${JSON.stringify({ harness: "brain", phase: "startup", ms: Math.round(performance.now() - started) })}\n`,
          )
      })
  }
  const kill = async (signal: NodeJS.Signals = "SIGKILL") => {
    if (!state.child) return
    state.child.kill(signal)
    await state.child.exited
    state.child = undefined
  }
  await start().catch(async (error: unknown) => {
    await fs.rm(home, { recursive: true, force: true })
    throw error
  })
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
