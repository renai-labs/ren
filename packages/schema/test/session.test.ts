import { describe, expect, test } from "bun:test"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Exit, Schema } from "effect"
import { Session } from "../src/index.js"

const decodes = (schema: Schema.Decoder<unknown>, input: unknown) =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(input))

const start = {
  sessionId: Session.ID.make("ses_01JZ0000000000000000000000"),
  harness: "opencode" as const,
  agent: "build",
  model: { providerId: "stub", modelId: "stub-model" },
  context: { team: "Ren" },
}

const send = {
  sessionId: Session.ID.make("ses_01JZ0000000000000000000000"),
  messageId: Session.MessageID.make("msg_01JZ0000000000000000000000"),
  prompt: { text: "hello" },
  sender: { userId: "user_1" },
}

const file = (url: string) => ({ ...send, prompt: { text: "look", files: [{ url }] } })

const key = { type: "key" as const, key: "sk-1" }
const oauth = {
  type: "oauth" as const,
  methodID: IntegrationMethodID.make("chatgpt-browser"),
  access: "a",
  refresh: "r",
  expires: 1_000,
}
const external = {
  type: "external" as const,
  methodID: IntegrationMethodID.make("aws"),
  metadata: { region: "us-east-1" },
}

describe("Session.ID", () => {
  test("create mints ses_ followed by a ULID, and two ids made in a row sort in creation order", () => {
    const first = Session.ID.create()
    const second = Session.ID.create()
    expect(first).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect([second, first].toSorted()).toEqual([first, second])
  })

  test("decodes any ses_ id OpenCode accepts, and rejects an id without the ses_ prefix", () => {
    expect(
      ["ses_01JZ0000000000000000000000", "ses_d35bf0f6effe0hTqCWhbs1F8Ux", "ses_x", "msg_1", "session_1", ""].map(
        (id) => decodes(Session.ID, id),
      ),
    ).toEqual([true, true, true, false, false, false])
  })
})

describe("StartInput", () => {
  test("decodes harness, agent, model and context, with title absent and interactive defaulting to true", () => {
    expect(Schema.decodeUnknownSync(Session.StartInput)(start)).toEqual({
      ...start,
      credentials: {},
      interactive: true,
    })
    expect(Schema.decodeUnknownSync(Session.StartInput)({ ...start, title: "Fix", interactive: false })).toEqual({
      ...start,
      title: "Fix",
      credentials: {},
      interactive: false,
    })
  })

  test("agent, model, context and credentials are optional, and missing ones mean none", () => {
    expect(Schema.decodeUnknownSync(Session.StartInput)({ sessionId: start.sessionId, harness: "opencode" })).toEqual({
      sessionId: start.sessionId,
      harness: "opencode",
      context: {},
      credentials: {},
      interactive: true,
    })
  })

  test("carries the Ren-minted session id", () => {
    expect(decodes(Session.StartInput, { ...start, sessionId: "msg_1" })).toBe(false)
  })

  test("context keys follow OpenCode's instruction entry keys: lowercase letters, digits, dot, underscore and dash, starting with a letter or digit", () => {
    expect(
      ["team", "a.b_c-d", "0day", "Team", "-team", ".team", "_team", "a b", ""].map((key) =>
        decodes(Session.StartInput, { ...start, context: { [key]: "value" } }),
      ),
    ).toEqual([true, true, true, false, false, false, false, false, false])
  })

  test("accepts a context value whose JSON encoding is exactly 256 KiB in UTF-8, as OpenCode measures it, and rejects one byte more", () => {
    expect(
      [
        "a".repeat(262_142),
        "a".repeat(262_143),
        "é".repeat(131_071),
        `${"é".repeat(131_071)}a`,
        '"'.repeat(131_071),
        `${'"'.repeat(131_071)}a`,
        "\n".repeat(131_071),
        `${"\n".repeat(131_071)}a`,
      ].map((value) => decodes(Session.StartInput, { ...start, context: { team: value } })),
    ).toEqual([true, false, true, false, true, false, true, false])
  })

  test("an empty context is allowed and means no entries", () => {
    expect(Schema.decodeUnknownSync(Session.StartInput)({ ...start, context: {} }).context).toEqual({})
  })

  test("credentials map a provider id to OpenCode's credential value: key, oauth or external", () => {
    const credentials = { openai: key, "openai-codex": oauth, "amazon-bedrock": external }
    expect(Schema.decodeUnknownSync(Session.StartInput)({ ...start, credentials }).credentials).toEqual(credentials)
  })

  test("a credential that is not one of OpenCode's credential values is rejected, and so is an empty provider id", () => {
    expect(
      [
        { openai: { type: "token", key: "sk-1" } },
        { openai: { type: "key" } },
        { openai: { ...oauth, expires: -1 } },
        { openai: "sk-1" },
        { "": key },
      ].map((credentials) => decodes(Session.StartInput, { ...start, credentials })),
    ).toEqual([false, false, false, false, false])
  })

  test("a Ren-managed key is an oauth credential under the ren method, with its expiry", () => {
    const managed = {
      type: "oauth" as const,
      methodID: Session.ManagedMethod,
      access: "sk-ren",
      refresh: "",
      expires: 5_000,
    }
    expect(
      Schema.decodeUnknownSync(Session.StartInput)({ ...start, credentials: { ren: managed } }).credentials,
    ).toEqual({ ren: managed })
  })
})

describe("SendInput", () => {
  test("decodes sessionId, messageId, prompt, delivery and sender, with no per-message agent or model", () => {
    expect(Schema.decodeUnknownSync(Session.SendInput)({ ...send, delivery: "queue", agent: "plan" })).toEqual({
      ...send,
      delivery: "queue" as const,
    })
  })

  test("a messageId must start with msg_, and create mints one", () => {
    expect(
      ["msg_01JZ0000000000000000000000", "msg_x", "ses_1", ""].map((messageId) =>
        decodes(Session.SendInput, { ...send, messageId }),
      ),
    ).toEqual([true, true, false, false])
    expect(Session.MessageID.create()).toMatch(/^msg_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  test("delivery is steer or queue, and defaults to steer", () => {
    expect(Schema.decodeUnknownSync(Session.SendInput)(send).delivery).toBe("steer")
    expect(["steer", "queue", "now", ""].map((delivery) => decodes(Session.SendInput, { ...send, delivery }))).toEqual([
      true,
      true,
      false,
      false,
    ])
  })

  test("a prompt needs text; files are optional", () => {
    expect(
      [{ text: "hello" }, { text: "hello", files: [] }, { text: "" }, {}, { files: [] }].map((prompt) =>
        decodes(Session.SendInput, { ...send, prompt }),
      ),
    ).toEqual([true, true, false, false, false])
  })

  test("a file is a data: URL with its media type, and a file given by any other URL is rejected", () => {
    expect(
      [
        "data:image/png;base64,iVBORw0KGgo=",
        "data:text/plain,hello",
        "https://example.com/a.png",
        "file:///workspace/a.png",
        "data:,hello",
        "data:image/png",
        "data:image,hello",
      ].map((url) => decodes(Session.SendInput, file(url))),
    ).toEqual([true, true, false, false, false, false, false])
    expect(
      decodes(Session.SendInput, {
        ...send,
        prompt: { text: "look", files: [{ url: "data:text/plain,a", name: "a.txt" }] },
      }),
    ).toBe(true)
  })

  test("accepts a data URL of any media type and any size: OpenCode tells the model about a file it cannot read", () => {
    expect(
      ["text/plain", "image/png", "image/svg+xml", "application/pdf", "IMAGE/PNG"].map((type) =>
        decodes(
          Session.SendInput,
          file(`data:${type};base64,${"A".repeat(type === "image/png" ? 8 * 1024 * 1024 : 4)}`),
        ),
      ),
    ).toEqual([true, true, true, true, true])
  })

  test("credentials are optional and have the same shape as start's", () => {
    expect(Schema.decodeUnknownSync(Session.SendInput)(send)).not.toHaveProperty("credentials")
    expect(Schema.decodeUnknownSync(Session.SendInput)({ ...send, credentials: { openai: key } }).credentials).toEqual({
      openai: key,
    })
    expect(decodes(Session.SendInput, { ...send, credentials: { openai: { type: "key" } } })).toBe(false)
  })
})
