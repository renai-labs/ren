import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Schema } from "effect"
import { Shared } from "./lib/shared.js"
import { SyncStorage } from "./lib/sync-storage.js"

setDefaultTimeout(120_000)

const files = Bun.serve({
  hostname: "0.0.0.0",
  port: 0,
  fetch: (request) =>
    new Response("a".repeat(Number(new URL(request.url).pathname.slice(1))), {
      headers: { "content-type": "text/plain" },
    }),
})
let cell: Shared.Runtime

beforeAll(async () => {
  cell = await Shared.make({ worker: SyncStorage.worker })
}, 180_000)

afterAll(async () => {
  await cell.dispose()
  await files.stop(true)
})

const Sizes = Schema.Struct({
  session: Schema.Struct({ time_suspended: Schema.NullOr(Schema.Int), idle_outcome: Schema.NullOr(Schema.String) }),
  messages: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      bytes: Schema.Int,
    }),
  ),
})

const largest = (sizes: typeof Sizes.Type) => Math.max(...sizes.messages.map((message) => message.bytes))

const large = async (behaviour: Parameters<ReturnType<typeof Shared.stub>["script"]>[0]) => {
  // oxlint-disable-next-line ren/no-comments -- Each case runs in a new process, because in celld the large strings of an earlier case can leave the isolate over its V8 heap limit.
  await cell.kill()
  await cell.start()
  const opened = await SyncStorage.turn(cell, behaviour)
  return Schema.decodeUnknownSync(Sizes)(await (await opened.request(`/test/sizes?session=${opened.id}`)).json())
}

const fetched = (bytes: number) => ({
  tool: {
    name: "webfetch",
    input: {
      url: `http://${SyncStorage.wrangler ? "127.0.0.1" : "host.docker.internal"}:${files.port}/${bytes}`,
      format: "text",
    },
  },
})

describe("S4-04: large message rows in a Durable Object", () => {
  test.each([2_000_000, 3_000_000])(
    "a tool output of %d bytes leaves a small row, because OpenCode cuts each tool output over 50 KB",
    async (bytes) => {
      const sizes = await large(fetched(bytes))
      expect({ outcome: sizes.session.idle_outcome, small: largest(sizes) < 2_000 }).toEqual({
        outcome: "succeeded",
        small: true,
      })
    },
  )

  test("model text of 2 MB: OpenCode writes a 2 MB row, and the turn succeeds", async () => {
    const sizes = await large({ reply: "b".repeat(2_000_000) })
    expect({
      outcome: sizes.session.idle_outcome,
      types: sizes.messages.map((message) => message.type),
      written: largest(sizes) > 2_000_000,
    }).toEqual({ outcome: "succeeded", types: ["user", "assistant", "idle"], written: true })
  })

  test("model text of 3 MB: celld cannot write the row, so the turn is lost and the session stays busy; Wrangler writes it", async () => {
    const sizes = await large({ reply: "b".repeat(3_000_000) })
    expect({
      session: sizes.session,
      types: sizes.messages.map((message) => message.type),
      written: largest(sizes) > 3_000_000,
    }).toEqual(
      SyncStorage.wrangler
        ? {
            session: { time_suspended: null, idle_outcome: "succeeded" },
            types: ["user", "assistant", "idle"],
            written: true,
          }
        : {
            session: { time_suspended: expect.any(Number), idle_outcome: null },
            types: ["user", "assistant"],
            written: false,
          },
    )
  })
})
