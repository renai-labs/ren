import { expect, setDefaultTimeout } from "bun:test"
import { AbsolutePath } from "@opencode/client/effect"
import { testEffect } from "@ren/executor/testing"
import { Effect, Fiber, Layer, Redacted, Schema, Stream } from "effect"
import { join } from "node:path"
import { SettingsHarness } from "./lib/settings-harness.js"
import { TestSettings } from "./lib/settings.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(60_000)

const it = testEffect(Layer.empty)
const stub = Shared.stub()

it.live("the native image tool uses the configured endpoint, model and key, and disappears with its catalog", () =>
  Effect.gen(function* () {
    const calls: Array<{ model: string; headers: Record<string, string> }> = []
    const provider = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: async (request) => {
            expect(new URL(request.url).pathname).toBe("/v1/images/generations")
            const body = Schema.decodeUnknownSync(Schema.Struct({ model: Schema.String }))(await request.json())
            calls.push({ model: body.model, headers: Object.fromEntries(request.headers) })
            return Response.json({ created: 1, data: [{ b64_json: btoa("image bytes") }] })
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const layers = TestSettings.layers({
      ren: { defaultModels: { image_generation: { providerId: "ren", modelId: "chosen" } } },
    })
    const opened = yield* SettingsHarness.open(layers)
    yield* opened.pull(layers, {
      models: [
        ...opened.access.endpoints,
        {
          id: "ren",
          protocol: "openai-chat",
          baseUrl: `${provider.url.origin}/v1`,
          apiKey: { key: Redacted.make("image-key") },
          models: [
            { id: "first", type: "image", protocol: "openai-images" },
            { id: "chosen", type: "image", protocol: "openai-images" },
          ],
        },
      ],
    })
    const notified = yield* opened.harness.chat.events.pipe(
      Stream.filter((event) => event.type === "session.inbox.enqueued" && event.data.item.type === "synthetic"),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* opened.turn(
      stub.script({ tool: { name: "experimental_image_generate", input: { prompt: "A logo", path: "logo.png" } } }),
    )
    yield* Fiber.join(notified)
    expect(calls).toHaveLength(1)
    expect(calls.at(0)).toMatchObject({
      model: "chosen",
      headers: {
        authorization: "Bearer image-key",
      },
    })
    expect(yield* Effect.promise(() => Bun.file(join(opened.directory, opened.sessionId, "logo.png")).text())).toBe(
      "image bytes",
    )
    const outside = yield* opened.client.session.create({
      location: { directory: AbsolutePath.make(opened.directory) },
    })
    const outsideTurn = stub.script()
    yield* opened.client.session.prompt({ sessionID: outside.id, text: `${outsideTurn.marker} go` })
    yield* opened.client.experimental.session.wait({ sessionID: outside.id })
    expect(outsideTurn.calls.at(0)?.tools).not.toContain("experimental_image_generate")
    yield* opened.pull(
      TestSettings.layers({
        ren: { defaultModels: { image_generation: { providerId: "ren", modelId: "first" } } },
        agents: [
          TestSettings.agent("ren", {}, { isSubagent: false }),
          TestSettings.agent("explore", {
            defaultModels: { image_generation: { providerId: "ren", modelId: "chosen" } },
          }),
        ],
      }),
    )
    const childNotice = yield* opened.harness.chat.events.pipe(
      Stream.filter((event) => event.type === "session.inbox.enqueued" && event.data.item.type === "synthetic"),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    )
    const child = stub.script({ tool: { name: "experimental_image_generate", input: { prompt: "A child's logo" } } })
    yield* opened.turn(
      stub.script({
        tool: { name: "subagent", input: { agent: "explore", description: "Draw", prompt: `${child.marker} draw` } },
      }),
    )
    yield* Fiber.join(childNotice)
    expect(calls.at(1)).toMatchObject({
      model: "chosen",
      headers: { authorization: "Bearer image-key" },
    })
    yield* opened.pull(
      TestSettings.layers({
        ren: {
          defaultModels: { image_generation: { providerId: "ren", modelId: "chosen" } },
          permissions: [{ action: "experimental_image_generate", resource: "ren/chosen", effect: "deny" }],
        },
      }),
    )
    const denied = stub.script({ tool: { name: "experimental_image_generate", input: { prompt: "Denied" } } })
    yield* opened.turn(denied)
    expect(JSON.stringify(denied.calls.at(-1)?.body.messages)).toContain("Permission denied")
    expect(calls).toHaveLength(2)
    yield* opened.pull(layers, { models: opened.access.endpoints })
    yield* opened.turn(stub.script({ tool: { name: "experimental_image_generate", input: { prompt: "A logo" } } }))
    expect(calls).toHaveLength(2)
  }),
)
