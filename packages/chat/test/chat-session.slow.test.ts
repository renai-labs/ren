import { expect, setDefaultTimeout, test } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { DateTime, Effect, Fiber, Layer, Schedule, Schema, SubscriptionRef } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChatSession } from "../src/chat-session.js"
import { ChatState } from "../src/chat-state.js"
import { ChatTest } from "./lib/chat.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()

test("a prompt sent while the brain's URL fails stays pending and is sent once with the same id after new access; a 502 for a gone sandbox and a 401 from an old token do the same", () =>
  ChatTest.live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const fault = { mode: "none" as "none" | "network" | "gone" | "unauthorized", attempts: 0 }
      const sent: Array<string> = []
      const accessed = { count: 0 }
      const fetching = FetchHttpClient.layer.pipe(
        Layer.provide(
          Layer.succeed(
            FetchHttpClient.Fetch,
            Object.assign(
              async (input: string | URL | Request, init?: RequestInit) => {
                const url = new URL(input instanceof Request ? input.url : String(input))
                const request = input instanceof Request ? input : new Request(url, init)
                if (url.pathname.endsWith("/prompt")) {
                  if (fault.mode !== "none") {
                    fault.attempts++
                    if (fault.mode === "network") throw new TypeError("fetch failed")
                    if (fault.mode === "gone")
                      return Response.json({ message: "The sandbox was not found", code: 502 }, { status: 502 })
                    return Response.json({ _tag: "UnauthorizedError", message: "An old generation" }, { status: 401 })
                  }
                  sent.push(
                    Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await request.clone().json()).id,
                  )
                }
                return brain.chatFetch(`${url.pathname}${url.search}`, request)
              },
              { preconnect: fetch.preconnect },
            ),
          ),
        ),
      )
      const chat = yield* ChatSession.make({
        sessionID: brain.id,
        access: () =>
          Effect.sync(() => {
            accessed.count++
            return {
              status: "ready" as const,
              url: "http://cell",
              token: "a-client-token",
              expiresAt: DateTime.makeUnsafe(Date.now() + 3_600_000),
            }
          }),
        sender: { userId: "user_1" },
      }).pipe(Effect.provide(fetching))
      yield* chat.open(brain.id)
      yield* ChatTest.until(chat.status, (status) => status === "connected")
      const failing = (mode: "network" | "gone" | "unauthorized") =>
        Effect.gen(function* () {
          fault.mode = mode
          fault.attempts = 0
          const before = accessed.count
          const script = stub.script()
          const sending = yield* chat.prompt({ text: script.marker }).pipe(Effect.forkChild)
          yield* Effect.sync(() => fault.attempts).pipe(
            Effect.repeat({ until: (attempts) => attempts >= 2, schedule: Schedule.spaced("50 millis") }),
          )
          const pending = ChatState.messages(yield* SubscriptionRef.get(chat.state), brain.id).find(
            (message) => message.type === "user" && message.text === script.marker,
          )
          fault.mode = "none"
          const id = yield* Fiber.join(sending)
          yield* Effect.promise(() => script.called())
          expect(pending?.id).toBe(id)
          expect(sent.filter((each) => each === id)).toHaveLength(1)
          expect(accessed.count).toBeGreaterThan(before)
        })
      yield* failing("network")
      yield* failing("gone")
      yield* failing("unauthorized")
    }),
  ))
