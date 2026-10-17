export * as Stack from "./stack.js"

import { Shared, Wrangler } from "@ren/cell/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import type { Models } from "@ren/schema/models"
import type { Session } from "@ren/schema/session"
import { ExecutorAdapter } from "./adapters/executor.js"
import { ExecutorDriver } from "./drivers/executor.js"
import { SessionDriver } from "./drivers/session.js"
import { FaultProxy } from "./faults/proxy.js"
import { Process } from "./process.js"
import { TestIssuer } from "./provider/issuer.js"
import { ModelProvider } from "./provider/model.js"

export const freshKey = (label = "key") => `chaos-${label}-${crypto.randomUUID().replaceAll("-", "")}`

export interface SessionOptions {
  readonly models?: Models.Access | null
  readonly hostToken?: string | false
  readonly hand?: Hand
  readonly start?: SessionDriver.StartOptions | false
}

const expectStatus = async (response: Response, status: number, label: string) => {
  if (response.status !== status)
    throw new Error(`${label} answered ${response.status}, not ${status}: ${await response.text()}`)
}

export const start = async () => {
  const provider = await ModelProvider.start()
  const providerProxy = await FaultProxy.make(new URL(provider.url).origin)
  const issuer = TestIssuer.start()
  const issuerProxy = await FaultProxy.make(issuer.url)
  const baseUrl = `${providerProxy.url}/v1`
  const cell = await Wrangler.make(
    { ...Shared.vars(baseUrl), REN_URL: issuerProxy.url },
  )
  const forgetCell = Process.onInterrupt(cell.crash)
  const cellProxy = await FaultProxy.make(cell.url)
  const brain = Brain.ID.create()
  const hands: Array<{ readonly instance: ExecutorAdapter.Instance; readonly proxy: FaultProxy.Instance }> = []

  const placed = new Map<Session.ID, Hand>()
  issuer.environments(async (sessionId) => {
    const hand = placed.get(sessionId)
    return hand && ExecutorAdapter.access({
      url: hand.proxy.url,
      environmentId: hand.instance.environmentId,
      brain: Brain.ofSession(sessionId),
      directory: `${hand.instance.workspace}/${sessionId}`,
      lifetimeMs: hand.lifetimeMs(),
      generation: hand.generation(),
    })
  })

  const attach = async <I extends ExecutorAdapter.Instance>(instance: I) => {
    const proxy = await FaultProxy.make(instance.url())
    hands.push({ instance, proxy })
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
    await Promise.all(hands.map((entry) => Promise.all([entry.proxy.stop(), entry.instance.dispose()])))
    await cellProxy.stop()
    await cell.dispose()
    await Promise.all([providerProxy.stop(), issuerProxy.stop(), provider.stop(), issuer.stop()])
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
      const driver = await SessionDriver.make(cellProxy.url, provider, async (sessionId) => ({
        access: access(),
        hostToken: await issuer.issue(sessionId),
      }))
      const sessionId = driver.sessionId
      if (options.hand) placed.set(sessionId, options.hand)
      const granted = options.models === undefined ? access() : options.models
      const hostToken =
        options.hostToken === false ? undefined : (options.hostToken ?? (await issuer.issue(sessionId)))
      if (granted) await expectStatus(await driver.configureModels(granted, hostToken), 204, "PUT /ren/models")
      const environment = options.hand && { environmentId: options.hand.instance.environmentId, directory: Environment.sessionDirectory(sessionId) }
      if (options.start !== false)
        await expectStatus(
          await driver.start({ ...options.start, ...(environment && { environment }) }),
          200,
          "start",
        )
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

export interface Hand {
  readonly instance: ExecutorAdapter.Instance
  readonly proxy: FaultProxy.Instance
  readonly generation: () => number
  readonly lifetimeMs: () => number
  readonly folder: (sessionId: Session.ID) => string
  readonly publish: (generation?: number, lifetimeMs?: number) => void
  readonly retarget: () => void
  readonly driver: () => ReturnType<typeof ExecutorDriver.connect>
}
