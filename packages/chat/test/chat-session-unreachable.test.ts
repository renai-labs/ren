import { expect, setDefaultTimeout, test } from "bun:test"
import { DateTime, Duration, Effect, Fiber, Layer, SubscriptionRef } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { ChatSession } from "../src/chat-session.js"
import { ChatState } from "../src/chat-state.js"
import { ChatTest } from "./lib/chat.js"

setDefaultTimeout(60_000)

const access = () =>
  Effect.sync(() => ({
    status: "ready" as const,
    url: "http://cell",
    token: "a-client-token",
    expiresAt: DateTime.makeUnsafe(Date.now() + 3_600_000),
  }))

test("a prompt to a brain that takes no connection shows unreachable after 20 seconds and stops as unsent after 2 minutes", () =>
  ChatTest.live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const refusing = FetchHttpClient.layer.pipe(
        Layer.provide(
          Layer.succeed(
            FetchHttpClient.Fetch,
            Object.assign(() => Promise.reject(new TypeError("fetch failed")), { preconnect: fetch.preconnect }),
          ),
        ),
      )
      const chat = yield* ChatSession.make({
        sessionID: brain.id,
        access,
        connection: { reconnectDelay: 600_000 },
      }).pipe(Effect.provide(refusing))
      // ast-grep-ignore: no-test-sleep -- the refused fetch settles on the real event loop, which TestClock does not drive
      const flush = Effect.promise(() => new Promise((r) => setTimeout(r, 5)))
      const status = Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(chat.state)
        const id = ChatState.messages(current, brain.id).at(0)?.id ?? ""
        return ChatState.pendingStatus(current, brain.id, id)
      })
      const advance = (steps: number, step: Duration.Input = "1 second") =>
        Effect.forEach(Array.from({ length: steps }), () => TestClock.adjust(step).pipe(Effect.andThen(flush)), {
          discard: true,
        })
      const sending = yield* chat.prompt({ text: "hello" }).pipe(Effect.flip, Effect.forkChild)
      yield* flush
      const behind = yield* chat.prompt({ text: "behind" }).pipe(Effect.flip, Effect.forkChild)
      yield* flush
      yield* advance(19)
      expect(yield* status).not.toBe("unreachable")
      expect(yield* status).not.toBe("unsent")
      yield* advance(2)
      expect(yield* status).toBe("unreachable")
      yield* advance(18, "5 seconds")
      expect(yield* status).toBe("unreachable")
      yield* advance(8, "5 seconds")
      const failed = yield* Fiber.join(sending)
      expect(failed._tag).toBe("ChatSession.AccessFailed")
      expect(yield* status).toBe("unsent")
      expect((yield* Fiber.join(behind))._tag).toBe("ChatSession.AccessFailed")
      const after = yield* SubscriptionRef.get(chat.state)
      expect([...after.stalled.values()]).toEqual(["unsent", "unsent"])
    }).pipe(Effect.provide(TestClock.layer())),
  ))
