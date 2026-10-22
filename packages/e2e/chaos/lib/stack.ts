export * as Stack from "./stack.js"

import { FakeRen, Shared, Wrangler } from "@ren/cell/testing"
import { Brain } from "@ren/schema/brain"
import type { Models } from "@ren/schema/models"
import type { Session } from "@ren/schema/session"
import { ExecutorAdapter } from "./adapters/executor.js"
import { ExecutorDriver } from "./drivers/executor.js"
import { SessionDriver } from "./drivers/session.js"
import { FaultProxy } from "./faults/proxy.js"
import { Process } from "./process.js"
import { ModelProvider } from "./provider/model.js"

export const freshKey = (label = "key") => `chaos-${label}-${crypto.randomUUID().replaceAll("-", "")}`

export interface SessionOptions {
  readonly models?: Models.Access | null
  readonly environment?: Environment
  readonly start?: SessionDriver.StartOptions | false
}

const expectStatus = async (response: Response, status: number, label: string) => {
  if (response.status !== status)
    throw new Error(`${label} answered ${response.status}, not ${status}: ${await response.text()}`)
}

export const start = async () => {
  const provider = await ModelProvider.start()
  const providerProxy = await FaultProxy.make(new URL(provider.url).origin)
  const ren = FakeRen.start()
  const renProxy = await FaultProxy.make(ren.url)
  const baseUrl = `${providerProxy.url}/v1`
  const cell = await Wrangler.make({ ...Shared.vars(baseUrl), REN_URL: renProxy.url })
  const forgetCell = Process.onInterrupt(cell.crash)
  const cellProxy = await FaultProxy.make(cell.url)
  const brain = Brain.ID.create()
  const environments: Array<{ readonly instance: ExecutorAdapter.Instance; readonly proxy: FaultProxy.Instance }> = []

  const place = (sessionId: Session.ID, brainId: Brain.ID, environment: Environment) =>
    ren.answer(sessionId, async () => ({
      type: "access",
      access: await ExecutorAdapter.access({
        url: environment.proxy.url,
        environmentId: environment.instance.environmentId,
        brain: brainId,
        directory: `${environment.instance.workspace}/${sessionId}`,
        lifetimeMs: environment.lifetimeMs(),
        generation: environment.generation(),
      }),
    }))

  const attach = async <I extends ExecutorAdapter.Instance>(instance: I) => {
    const proxy = await FaultProxy.make(instance.url())
    environments.push({ instance, proxy })
    const state = { generation: 1, lifetimeMs: 3_600_000 }
    return {
      instance,
      proxy,
      generation: () => state.generation,
      lifetimeMs: () => state.lifetimeMs,
      folder: (sessionId: Session.ID) => `${instance.workspace}/${sessionId}`,
      publish: (generation = state.generation, lifetimeMs = state.lifetimeMs) => {
        state.generation = generation
        state.lifetimeMs = lifetimeMs
      },
      retarget: () => proxy.target(instance.url()),
      driver: async () => ExecutorDriver.connect(proxy.url, await ExecutorAdapter.token(instance.environmentId, brain)),
    }
  }

  const access = (key = freshKey(), expiresAtMs?: number) =>
    Shared.access({ stub: Shared.apiKey(key, expiresAtMs) }, baseUrl)

  const dispose = async () => {
    forgetCell()
    await Promise.all(environments.map((entry) => Promise.all([entry.proxy.stop(), entry.instance.dispose()])))
    await cellProxy.stop()
    await cell.dispose()
    await Promise.all([providerProxy.stop(), renProxy.stop(), provider.stop(), ren.stop()])
  }

  return {
    provider,
    providerProxy,
    ren,
    renProxy,
    cell,
    cellProxy,
    access,
    session: async (options: SessionOptions = {}) => {
      const driver = await SessionDriver.make(
        { kind: "wrangler", url: cellProxy.url, ren, brain: Brain.ID.create },
        provider,
      )
      const sessionId = driver.sessionId
      if (options.environment) place(sessionId, driver.brainId, options.environment)
      const granted = options.models === undefined ? access() : options.models
      if (granted) await expectStatus(await driver.configureModels(granted), 204, "POST /ren/wake")
      const directory = options.environment?.folder(sessionId)
      if (options.start !== false)
        await expectStatus(await driver.start({ ...options.start, ...(directory && { directory }) }), 200, "start")
      return driver
    },
    environment: async (label: string) => attach(await ExecutorAdapter.localProcess({ label })),
    dockerEnvironment: async (label: string) => {
      const container = await ExecutorAdapter.dockerContainer({ label })
      return { ...(await attach(container)), container }
    },
    restartCell: async () => {
      await cell.crash()
      await cell.start()
    },
    dispose,
  }
}

export type Instance = Awaited<ReturnType<typeof start>>

export interface Environment {
  readonly instance: ExecutorAdapter.Instance
  readonly proxy: FaultProxy.Instance
  readonly generation: () => number
  readonly lifetimeMs: () => number
  readonly folder: (sessionId: Session.ID) => string
  readonly publish: (generation?: number, lifetimeMs?: number) => void
  readonly retarget: () => void
  readonly driver: () => ReturnType<typeof ExecutorDriver.connect>
}
