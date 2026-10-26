import { afterAll, describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { FakeRen, TestSettings, TestToken } from "@ren/cell/testing"
import { E2BSandbox } from "@ren/core/sandbox-provider/e2b"
import { SandboxProvider } from "@ren/core/sandbox-provider"
const hostTokenHeader = "ren-host-token"
import { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Duration, Effect, Layer, ManagedRuntime, Option, Redacted, Schema, Struct } from "effect"
import { FetchHttpClient } from "effect/http"
import { Platform } from "../lib/platform.js"
import { LiteLLM } from "../lib/provider/litellm.js"
import { Wait } from "../lib/wait.js"

// oxlint-disable-next-line ren/no-comments -- The sandbox reaches the test's Ren and LiteLLM through public tunnels to these local ports.
const renPort = Number(process.env.CHAOS_REN_TUNNEL_PORT ?? 4111)
const renTunnel = process.env.CHAOS_REN_TUNNEL_URL ?? ""
const litellmTunnel = process.env.CHAOS_LITELLM_TUNNEL_URL ?? ""

const small = "anthropic/claude-haiku-5-5"
const added = "openai/gpt-5.6-terra"

const unmet =
  Platform.e2b ??
  Platform.litellm ??
  (renTunnel && litellmTunnel ? undefined : "C12 needs CHAOS_REN_TUNNEL_URL and CHAOS_LITELLM_TUNNEL_URL")

const accessFor = async (key: string): Promise<Models.Access> => {
  const response = await fetch(`${LiteLLM.url}/model/info`, { headers: { authorization: `Bearer ${key}` } })
  const catalog = Models.fromLiteLLM(Schema.decodeUnknownSync(Models.LiteLLMModelInfo)(await response.json()))
  return {
    endpoints: catalog.endpoints.map((endpoint) =>
      Struct.assign(endpoint, { baseUrl: `${litellmTunnel}/v1`, apiKey: { key: Redacted.make(key) } }),
    ),
  }
}

describe.skipIf(unmet !== undefined)("hot reload on a paused E2B brain (spec §9.1 C12)", () => {
  const cleanups: Array<() => Promise<unknown>> = []

  afterAll(async () => {
    await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
  }, 120_000)

  test("a push does not resume a paused brain; the wake applies the settings and reads the models of the pause", async () => {
    const provider = ManagedRuntime.make(E2BSandbox.layer.pipe(Layer.provide(FetchHttpClient.layer)))
    cleanups.push(() => provider.dispose())
    const sandbox = <A, E>(use: (service: SandboxProvider.Interface) => Effect.Effect<A, E>) =>
      provider.runPromise(SandboxProvider.Service.use(use))
    const key = await LiteLLM.generate({ duration: "2h", models: [small] })
    cleanups.push(() => LiteLLM.remove(key))
    const ren = FakeRen.start({ port: renPort })
    cleanups.push(() => ren.stop())
    const brain = Brain.ID.create()
    ren.models(await accessFor(key), brain)
    ren.settings(TestSettings.layers({ ren: { model: { endpointId: "anthropic", modelId: "claude-haiku-5-5" } } }))
    const created = await sandbox((service) =>
      service.create({
        brainId: brain,
        generation: 1,
        env: {
          REN_URL: renTunnel,
          REN_BRAIN_ID: brain,
          REN_BRAIN_GENERATION: "1",
          OPENCODE_CONFIG: "{}",
          ...TestToken.vars,
        },
        proxy: Option.none(),
      }),
    )
    cleanups.push(() => sandbox((service) => service.destroy(created.binding)))
    const server = TestToken.basic(await TestToken.sign({ scope: "server", brain, gen: 1, exp: TestToken.exp(3600) }))
    const host = await FakeRen.hostToken(brain)
    const call = (path: string, body?: unknown) =>
      fetch(`${created.url}${path}`, {
        method: "POST",
        headers: { authorization: server, [hostTokenHeader]: host, "content-type": "application/json" },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
      })
    const opencode = OpenCode.make({ baseUrl: created.url, headers: { authorization: server } })
    const listed = async () =>
      (await opencode.model.list()).data.map((model) => `${model.providerID}/${model.id}`).toSorted()
    await Wait.until("the brain to answer", 180_000, async () =>
      (await call("/ren/wake").catch(() => undefined))?.ok ? true : undefined,
    )
    const sessionId = Session.ID.create()
    expect((await call("/ren/sessions", { sessionId, harness: "opencode", interactive: false })).status).toBe(200)
    expect(await listed()).toEqual(["anthropic/claude-haiku-5-5"])

    await sandbox((service) => service.keepAlive(created.binding, Duration.seconds(1)))
    await Wait.until("the sandbox to pause", 120_000, async () =>
      (await sandbox((service) => service.status(created.binding))) === "paused" ? true : undefined,
    )
    await LiteLLM.allow(key, [small, added])
    ren.settings(
      TestSettings.layers({
        ren: { model: { endpointId: "anthropic", modelId: "claude-haiku-5-5" }, instructions: "Rule of the pause." },
      }),
    )
    const pulledBefore = ren.pulls.length
    const pushed = await fetch(`${created.url}/ren/pull`, {
      method: "POST",
      headers: { authorization: server },
      signal: AbortSignal.timeout(5000),
    }).then(
      (response) => response.status,
      () => 0,
    )
    expect(pushed).not.toBe(202)
    expect(await sandbox((service) => service.status(created.binding))).toBe("paused")

    await sandbox((service) => service.connect(created.binding, Option.none()))
    expect((await call("/ren/wake")).ok).toBe(true)
    expect(ren.pulls.length).toBeGreaterThan(pulledBefore)
    expect(await listed()).toEqual(["anthropic/claude-haiku-5-5", "openai/gpt-5.6-terra"])
  }, 900_000)
})
