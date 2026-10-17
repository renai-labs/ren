export * as Stack from "./stack.js"

import { Shared, Wrangler } from "@ren/cell/testing"
import { Brain } from "@ren/schema/brain"
import type { Models } from "@ren/schema/models"
import { ExecutorAdapter } from "./adapters/executor.js"
import { Control } from "./control.js"
import { ExecutorDriver } from "./drivers/executor.js"
import { SessionDriver } from "./drivers/session.js"
import { FaultProxy } from "./faults/proxy.js"
import { Process } from "./process.js"
import { TestIssuer } from "./provider/issuer.js"
import { ModelProvider } from "./provider/model.js"

export const freshKey = (label = "key") => `chaos-${label}-${crypto.randomUUID().replaceAll("-", "")}`

export interface SessionOptions {
  readonly models?: Models.Access | null
  readonly hostToken?: string
  readonly start?: SessionDriver.StartOptions | false
}

const expectStatus = async (response: Response, status: number, label: string) => {
  if (response.status !== status)
    throw new Error(`${label} answered ${response.status}, not ${status}: ${await response.text()}`)
}

export const start = async () => {
  const control = Control.start()
  const provider = await ModelProvider.start()
  const providerProxy = await FaultProxy.make(new URL(provider.url).origin)
  const issuer = TestIssuer.start()
  const issuerProxy = await FaultProxy.make(issuer.url)
  const baseUrl = `${providerProxy.url}/v1`
  const cell = await Wrangler.make(
    { ...Shared.vars(baseUrl), REN_URL: issuerProxy.url, CHAOS_CONTROL_URL: control.url },
    "test/lib/environment-worker.ts",
  )
  const forgetCell = Process.onInterrupt(cell.crash)
  const cellProxy = await FaultProxy.make(cell.url)
  const brain = Brain.ID.create()
  const hands: Array<{ readonly instance: ExecutorAdapter.Instance; readonly proxy: FaultProxy.Instance }> = []

  const attach = async <I extends ExecutorAdapter.Instance>(instance: I) => {
    const proxy = await FaultProxy.make(instance.url())
    hands.push({ instance, proxy })
    const state = { generation: 1 }
    const publish = async (generation = state.generation) => {
      state.generation = generation
      control.publish(
        await ExecutorAdapter.access({
          url: proxy.url,
          environmentId: instance.environmentId,
          brain,
          lifetimeMs: 3_600_000,
          generation,
        }),
      )
    }
    await publish()
    return {
      instance,
      proxy,
      generation: () => state.generation,
      location: () => ({ environmentId: instance.environmentId, directory: instance.workspace }),
      publish,
      retarget: () => proxy.target(instance.url()),
      driver: async () => ExecutorDriver.connect(proxy.url, await ExecutorAdapter.token(instance.environmentId, brain)),
    }
  }

  const access = (key = freshKey(), expiresAtMs?: number) =>
    Shared.access({ stub: Shared.apiKey(key, expiresAtMs) }, baseUrl)

  const dispose = async () => {
    forgetCell()
    await Promise.all(hands.map((entry) => Promise.all([entry.proxy.stop(), entry.instance.dispose()])))
    await cellProxy.stop()
    await cell.dispose()
    await Promise.all([providerProxy.stop(), issuerProxy.stop(), provider.stop(), issuer.stop(), control.stop()])
  }

  return {
    provider,
    providerProxy,
    issuer,
    issuerProxy,
    cell,
    cellProxy,
    access,
    session: async (options: SessionOptions = {}) => {
      const driver = await SessionDriver.make(cellProxy.url, provider)
      const granted = options.models === undefined ? access() : options.models
      if (granted) await expectStatus(await driver.configureModels(granted, options.hostToken), 204, "PUT /ren/models")
      if (options.start !== false) await expectStatus(await driver.start(options.start ?? {}), 200, "start")
      return driver
    },
    hand: async (label: string) => attach(await ExecutorAdapter.localProcess({ label })),
    dockerHand: async (label: string) => attach(await ExecutorAdapter.dockerContainer({ label })),
    restartCell: async () => {
      await cell.crash()
      await cell.start()
    },
    dispose,
  }
}

export type Instance = Awaited<ReturnType<typeof start>>

export type Hand = Awaited<ReturnType<Instance["hand"]>>
