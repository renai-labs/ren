import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Shared } from "./lib/shared.js"

const stub = Shared.stub()

const Chunk = Schema.fromJsonString(
  Schema.Struct({
    choices: Schema.Array(
      Schema.Struct({
        delta: Schema.Struct({
          content: Schema.optional(Schema.String),
          tool_calls: Schema.optional(
            Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String, arguments: Schema.String }) })),
          ),
        }),
        finish_reason: Schema.NullOr(Schema.String),
      }),
    ),
  }),
)

const decodeChunk = Schema.decodeUnknownSync(Chunk)

const complete = (messages: ReadonlyArray<{ role: string; content: string }>, headers?: Record<string, string>) =>
  fetch(`${stub.url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      model: "stub-model",
      stream: true,
      messages,
      tools: [{ type: "function", function: { name: "question", parameters: {} } }],
    }),
  })

const user = (content: string) => [{ role: "user", content }]

const frames = (body: string) =>
  body
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => frame.slice("data: ".length))

const read = async (response: Response) => {
  const data = frames(await response.text())
  const chunks = data.filter((frame) => frame !== "[DONE]").map((frame) => decodeChunk(frame))
  const choices = chunks.flatMap((chunk) => chunk.choices)
  return {
    done: data.at(-1) === "[DONE]",
    text: choices.map((choice) => choice.delta.content ?? "").join(""),
    toolCalls: choices.flatMap((choice) => choice.delta.tool_calls ?? []).map((call) => call.function),
    finish: choices.flatMap((choice) => (choice.finish_reason ? [choice.finish_reason] : [])),
  }
}

const decoder = new TextDecoder()

const readUntil = async (
  read: () => Promise<{ readonly done: boolean; readonly value?: Uint8Array }>,
  needle: string,
  text = "",
): Promise<string> => {
  if (text.includes(needle)) return text
  const next = await read()
  if (next.done) return text
  return readUntil(read, needle, text + decoder.decode(next.value))
}

describe("stub model", () => {
  test("streams the default reply and ends with [DONE]", async () => {
    const response = await complete(user("hello"))
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(await read(response)).toEqual({ done: true, text: "stub reply", toolCalls: [], finish: ["stop"] })
  })

  test("routes a turn to its script by the marker in the last user message", async () => {
    const script = stub.script({ reply: "scripted answer" })
    expect(await read(await complete(user(`do it ${script.marker}`)))).toMatchObject({ text: "scripted answer" })
    expect(script.calls).toHaveLength(1)
    expect(script.calls[0]).toMatchObject({ kind: "turn", marker: script.marker, text: `do it ${script.marker}` })
  })

  test("ignores a marker that is not in the last user message", async () => {
    const script = stub.script({ reply: "scripted answer" })
    const messages = [
      { role: "user", content: `first ${script.marker}` },
      { role: "assistant", content: "ok" },
      { role: "user", content: "The server restarted while you were working" },
    ]
    expect(await read(await complete(messages))).toMatchObject({ text: "stub reply" })
    expect(script.calls).toHaveLength(0)
  })

  test("answers a title call with a title and never applies a script to it", async () => {
    const script = stub.script({ hold: true, status: 500 })
    const response = await complete([
      { role: "system", content: "You are a title generator. You output ONLY a thread title." },
      { role: "user", content: `hello ${script.marker}` },
    ])
    expect(await read(response)).toMatchObject({ done: true, text: "Stub title" })
    expect(script.calls).toHaveLength(0)
    expect(stub.calls.at(-1)).toMatchObject({ kind: "title", marker: script.marker })
  })

  test("holds after the first chunk until released", async () => {
    const script = stub.script({ reply: "one two three", hold: true })
    const reader = (await complete(user(script.marker))).body?.getReader()
    if (!reader) throw new Error("the stub answered without a body")
    const chunk = () => reader.read()
    expect(await readUntil(chunk, '"content":"one "')).not.toContain("two")
    const pending = readUntil(chunk, "[DONE]")
    await read(await complete(user("a full turn in between")))
    expect(await Promise.race([pending, Promise.resolve("held")])).toBe("held")
    script.release()
    expect(await pending).toContain('"content":"three"')
  })

  test("answers with the scripted status and an OpenAI error body", async () => {
    const failing = stub.script({ status: 500 })
    const limited = stub.script({ status: 429 })
    const failed = await complete(user(failing.marker))
    const throttled = await complete(user(limited.marker))
    expect(failed.status).toBe(500)
    expect(throttled.status).toBe(429)
    expect(await failed.json()).toMatchObject({ error: { message: "stub model status 500" } })
  })

  test("breaks the connection after the first chunk", async () => {
    const script = stub.script({ cut: true })
    const response = await complete(user(script.marker))
    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toThrow()
  })

  test("sends a chunk that is not JSON, then finishes", async () => {
    const script = stub.script({ malformed: true })
    const data = frames(await (await complete(user(script.marker))).text())
    expect(data).toContain("{not json")
    expect(data.at(-1)).toBe("[DONE]")
  })

  test("asks for the tool call until a tool result follows the last user message", async () => {
    const script = stub.script({ tool: { name: "question", input: { text: "which?" } } })
    const first = await read(await complete(user(script.marker)))
    expect(first.toolCalls).toEqual([{ name: "question", arguments: '{"text":"which?"}' }])
    expect(first.finish).toEqual(["tool_calls"])
    const answered = await read(
      await complete([
        { role: "user", content: script.marker },
        { role: "assistant", content: "" },
        { role: "tool", content: "this one" },
      ]),
    )
    expect(answered).toMatchObject({ text: "stub reply", toolCalls: [], finish: ["stop"] })
    const asked = await read(
      await complete([
        { role: "user", content: script.marker },
        { role: "tool", content: "this one" },
        { role: "user", content: `again ${script.marker}` },
      ]),
    )
    expect(asked.toolCalls).toHaveLength(1)
  })

  test("set replaces the behaviour of later calls", async () => {
    const script = stub.script({ status: 500 })
    expect((await complete(user(script.marker))).status).toBe(500)
    script.set({ reply: "recovered" })
    expect(await read(await complete(user(script.marker)))).toMatchObject({ text: "recovered" })
  })

  test("called resolves with a past or a future call of the script", async () => {
    const script = stub.script()
    await read(await complete(user(`first ${script.marker}`)))
    expect(await script.called(1)).toMatchObject({ text: `first ${script.marker}` })
    const second = script.called(2)
    await read(await complete(user(`second ${script.marker}`)))
    expect(await second).toMatchObject({ text: `second ${script.marker}` })
  })

  test("records the authorization header and the offered tools", async () => {
    const script = stub.script()
    await read(await complete(user(script.marker), { authorization: "Bearer key-1" }))
    expect(script.calls[0]).toMatchObject({ authorization: "Bearer key-1", tools: ["question"] })
  })

  test("rejects a body that is not a chat completion request, and unknown paths", async () => {
    const invalid = await fetch(`${stub.url}/chat/completions`, { method: "POST", body: "{}" })
    const unknown = await fetch(`${stub.url}/models`)
    expect(invalid.status).toBe(400)
    expect(unknown.status).toBe(404)
  })
})
