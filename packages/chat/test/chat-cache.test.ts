import { expect, test } from "bun:test"
import { ChatCache } from "../src/chat-cache.js"
import { Fixture } from "./lib/fixture.js"

const idle = (id: string, created: number) =>
  Fixture.message({ id, type: "idle", time: { created }, outcome: "succeeded" })

test("the cache keeps the newest 20 turns: a turn starts at a user or shell message", () => {
  const messages = [
    idle("msg_lead", 0),
    ...Array.from({ length: 25 }, (_, index) => [
      Fixture.user(`msg_u${index}`, index * 2 + 1),
      idle(`msg_i${index}`, index * 2 + 2),
    ]).flat(),
  ]
  const kept = ChatCache.newestTurns(messages)
  expect(kept.filter((message) => message.type === "user")).toHaveLength(20)
  expect(String(kept.at(0)?.id)).toBe("msg_u5")
  expect(String(kept.at(-1)?.id)).toBe("msg_i24")
  expect(ChatCache.newestTurns(messages.slice(0, 7))).toEqual(messages.slice(0, 7))
})
