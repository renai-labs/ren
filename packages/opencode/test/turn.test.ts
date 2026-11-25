import { expect, test } from "bun:test"
import { Session } from "@ren/schema/session"
import { SessionEvent } from "@ren/schema/session/event"
import { SessionMessage } from "@ren/schema/session/message"
import { Schema } from "effect"
import { Turn } from "../src/turn.js"

const sessionID = Session.ID.create()
const assistantMessageID = SessionMessage.ID.create()
const step = { sessionID, assistantMessageID }
const decode = Schema.decodeUnknownSync(SessionEvent.Event)

const run = (events: ReadonlyArray<{ readonly type: string; readonly data: object }>) =>
  events.reduce(
    (result, event, index) => {
      const next = Turn.next(result.state, decode({ id: `evt_${index}`, created: index, ...event }))
      return { state: next.state, parts: [...result.parts, ...next.parts] }
    },
    { state: Turn.start(sessionID), parts: Array.of<Turn.Part>() },
  )

test("a remote turn becomes one stream with the tools the brain ran and the usage of every step", () => {
  const result = run([
    { type: "session.execution.started", data: { sessionID } },
    { type: "session.reasoning.started", data: { ...step, ordinal: 0 } },
    { type: "session.reasoning.delta", data: { ...step, ordinal: 0, delta: "Plan" } },
    { type: "session.reasoning.ended", data: { ...step, ordinal: 0, text: "Plan" } },
    { type: "session.text.started", data: { ...step, ordinal: 0 } },
    { type: "session.text.delta", data: { ...step, ordinal: 0, delta: "Reading" } },
    { type: "session.text.ended", data: { ...step, ordinal: 0, text: "Reading" } },
    { type: "session.tool.input.started", data: { ...step, id: "call_1", name: "read" } },
    { type: "session.tool.input.delta", data: { ...step, id: "call_1", delta: '{"path":"a.ts"}' } },
    { type: "session.tool.input.ended", data: { ...step, id: "call_1", text: '{"path":"a.ts"}' } },
    { type: "session.tool.called", data: { ...step, id: "call_1", input: { path: "a.ts" }, executed: false } },
    {
      type: "session.tool.success",
      data: {
        ...step,
        id: "call_1",
        content: [
          { type: "text", text: "export {}" },
          { type: "file", uri: "https://ren.test/a.png", mime: "image/png", name: "a.png" },
        ],
        executed: false,
      },
    },
    {
      type: "session.step.ended",
      data: {
        ...step,
        finish: "tool-calls",
        cost: 0,
        tokens: { input: 10, output: 4, reasoning: 1, cache: { read: 2, write: 3 } },
      },
    },
    {
      type: "session.step.ended",
      data: {
        ...step,
        finish: "stop",
        cost: 0,
        tokens: { input: 20, output: 6, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    },
    { type: "session.execution.succeeded", data: { sessionID } },
    { type: "session.text.started", data: { ...step, ordinal: 1 } },
  ])
  expect(result.state.ended).toBe(true)
  expect(result.parts).toEqual([
    { type: "reasoning-start", id: `reasoning:${assistantMessageID}:0` },
    { type: "reasoning-delta", id: `reasoning:${assistantMessageID}:0`, delta: "Plan" },
    { type: "reasoning-end", id: `reasoning:${assistantMessageID}:0` },
    { type: "text-start", id: `text:${assistantMessageID}:0` },
    { type: "text-delta", id: `text:${assistantMessageID}:0`, delta: "Reading" },
    { type: "text-end", id: `text:${assistantMessageID}:0` },
    { type: "tool-input-start", id: "call_1", toolName: "read", providerExecuted: true },
    { type: "tool-input-delta", id: "call_1", delta: '{"path":"a.ts"}' },
    { type: "tool-input-end", id: "call_1" },
    { type: "tool-call", toolCallId: "call_1", toolName: "read", input: '{"path":"a.ts"}', providerExecuted: true },
    {
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "read",
      result: "export {}\n[file a.png (image/png): https://ren.test/a.png]",
    },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 35, noCache: 30, cacheRead: 2, cacheWrite: 3 },
        outputTokens: { total: 11, text: 10, reasoning: 1 },
      },
    },
  ])
})

test("a tool that failed before it was called still reaches the stream as a called tool with an error", () => {
  const result = run([
    { type: "session.tool.input.started", data: { ...step, id: "call_1", name: "edit" } },
    { type: "session.tool.input.ended", data: { ...step, id: "call_1", text: "{not json" } },
    {
      type: "session.tool.failed",
      data: { ...step, id: "call_1", error: { type: "tool.input-json", message: "Bad input" }, executed: false },
    },
    {
      type: "session.tool.failed",
      data: { ...step, id: "call_1", error: { type: "aborted", message: "Interrupted" }, executed: false },
    },
  ])
  expect(result.parts).toEqual([
    { type: "tool-input-start", id: "call_1", toolName: "edit", providerExecuted: true },
    { type: "tool-input-end", id: "call_1" },
    { type: "tool-call", toolCallId: "call_1", toolName: "edit", input: "{}", providerExecuted: true },
    { type: "tool-result", toolCallId: "call_1", toolName: "edit", result: "Bad input", isError: true },
  ])
})

test("tool events of a tool whose input the turn never saw stay out of the stream", () => {
  const result = run([
    { type: "session.tool.input.delta", data: { ...step, id: "call_1", delta: "{}" } },
    { type: "session.tool.called", data: { ...step, id: "call_1", input: {}, executed: false } },
    {
      type: "session.tool.success",
      data: { ...step, id: "call_1", content: [{ type: "text", text: "done" }], executed: false },
    },
  ])
  expect(result.parts).toEqual([])
})

test("a failed turn ends the stream with an error", () => {
  const result = run([
    {
      type: "session.step.failed",
      data: {
        ...step,
        error: { type: "provider", message: "Overloaded" },
        tokens: { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    },
    { type: "session.execution.failed", data: { sessionID, error: { type: "provider", message: "Overloaded" } } },
    { type: "session.execution.succeeded", data: { sessionID } },
  ])
  expect(result.state.ended).toBe(true)
  expect(result.parts).toEqual([{ type: "error", error: new Error("Overloaded") }])
})

test("an interrupted turn finishes with the interruption as the raw reason", () => {
  const result = run([{ type: "session.execution.interrupted", data: { sessionID, reason: "user" } }])
  expect(result.state.ended).toBe(true)
  expect(result.parts).toEqual([
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "interrupted:user" },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
    },
  ])
})

test("events of a subagent session stay out of the stream", () => {
  const child = Session.ID.create()
  const result = run([
    { type: "session.text.started", data: { sessionID: child, assistantMessageID, ordinal: 0 } },
    { type: "session.execution.succeeded", data: { sessionID: child } },
  ])
  expect(result.state.ended).toBe(false)
  expect(result.parts).toEqual([])
})
