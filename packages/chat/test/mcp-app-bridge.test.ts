import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { McpAppBridge } from "../src/mcp-app-bridge.js"

describe("McpAppBridge.policy", () => {
  const directive = (policy: string, name: string) =>
    policy
      .split("; ")
      .find((each) => each.startsWith(`${name} `))
      ?.split(" ")
      .slice(1)

  test("a view without domains reaches no network", () => {
    const policy = McpAppBridge.policy({ connect: [], resource: [] })
    expect(directive(policy, "connect-src")).toEqual(["'none'"])
    expect(directive(policy, "img-src")).toEqual(["data:", "blob:"])
  })

  test("declared https domains widen connect-src and img-src; others are dropped", () => {
    const policy = McpAppBridge.policy({
      connect: ["https://api.linear.app", "wss://live.linear.app", "http://plain.example", "https://x.example/path"],
      resource: ["https://*.cdn.example", "https://evil.example; script-src *"],
    })
    expect(directive(policy, "connect-src")).toEqual(["https://api.linear.app"])
    expect(directive(policy, "img-src")).toEqual(["data:", "blob:", "https://*.cdn.example"])
    expect(directive(policy, "script-src")).toEqual(["'unsafe-inline'"])
  })
})

describe("McpAppBridge.admit", () => {
  test("allows 30 calls a minute, then admits again once the oldest has aged out", () => {
    const full = Array.from({ length: 30 }, (_, index) => 1_000 + index)
    expect(McpAppBridge.admit(full, 2_000)).toBeUndefined()
    expect(McpAppBridge.admit(full, 61_010)?.length).toBe(20)
    expect(McpAppBridge.admit(full.slice(1), 2_000)?.length).toBe(30)
  })
})

describe("McpAppBridge requests", () => {
  test("a tool call names its tool; the view cannot name a server", () => {
    const call = McpAppBridge.toolCall({ name: "create_issue", arguments: { title: "Fix login" }, server: "other" })
    expect(Option.getOrUndefined(call)).toMatchObject({ name: "create_issue", arguments: { title: "Fix login" } })
    expect(Option.isNone(McpAppBridge.toolCall({ arguments: {} }))).toBe(true)
  })

  test("a post takes one text part or a list of them", () => {
    expect(McpAppBridge.postText({ role: "user", content: { type: "text", text: "a" } })).toEqual(Option.some("a"))
    expect(
      McpAppBridge.postText({
        role: "user",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toEqual(Option.some("a\nb"))
    expect(Option.isNone(McpAppBridge.postText({ content: { type: "image" } }))).toBe(true)
  })

  test.each([["http://example.com"], ["javascript:alert(1)"], ["data:text/html,x"], ["not a url"]])(
    "a link that is not https is refused: %s",
    (url) => {
      expect(Option.isNone(McpAppBridge.link({ url }))).toBe(true)
    },
  )

  test("an https link is kept", () => {
    expect(McpAppBridge.link({ url: "https://linear.app/x" })).toEqual(Option.some("https://linear.app/x"))
  })
})

describe("McpAppBridge.callResult", () => {
  test("an object output is the structured content; images keep their data", () => {
    expect(
      McpAppBridge.callResult({
        output: { id: "ENG-1" },
        content: [
          { type: "text", text: "ok" },
          { type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png" },
          { type: "file", uri: "https://x.example/a.png", mime: "image/png" },
        ],
      }),
    ).toEqual({
      content: [
        { type: "text", text: "ok" },
        { type: "image", mimeType: "image/png", data: "AAAA" },
      ],
      structuredContent: { id: "ENG-1" },
    })
  })
})
