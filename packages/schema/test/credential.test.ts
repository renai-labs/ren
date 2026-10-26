import { describe, expect, test } from "bun:test"
import { Redacted, Schema } from "effect"
import { Credential } from "../src/credential.js"

const isLabel = Schema.is(Credential.Label)
const isHost = Schema.is(Credential.Host)
const decodeCreate = Schema.decodeUnknownExit(Credential.CreateInput)

describe("Credential.Label", () => {
  test("a reserved env name is refused in any case, and a normal one is accepted (C48)", () => {
    expect(
      ["PATH", "LD_PRELOAD", "REN_X", "GH_TOKEN", "NODE_OPTIONS", "HTTPS_PROXY", "SSL_CERT_FILE"].map(isLabel),
    ).toEqual([false, false, false, false, false, false, false])
    expect(isLabel("ld_preload")).toBe(false)
    expect(["STRIPE_API_KEY", "GITHUB", "MCP_META_ADS__ACME"].map(isLabel)).toEqual([true, true, true])
  })
})

describe("Credential.Host", () => {
  test("hosts are names, one leading wildcard label or * for any host; no IP address or private name (A39)", () => {
    expect(["api.stripe.com", "*.stripe.com", "github.com", "*"].map(isHost)).toEqual([true, true, true, true])
    expect(
      [
        "*.com",
        "10.0.0.1",
        "[::1]",
        "::1",
        "localhost",
        "ren.internal",
        "printer.local",
        "a.*.com",
        "Api.Stripe.com",
      ].map(isHost),
    ).toEqual([false, false, false, false, false, false, false, false, false])
  })
})

describe("Credential.CreateInput", () => {
  const base = { owner: { kind: "org" }, label: "STRIPE_API_KEY" }
  test("hosts are required (A39)", () => {
    expect(decodeCreate({ ...base, hosts: [], value: { type: "key", value: "sk_live_1" } })._tag).toBe("Failure")
    expect(decodeCreate({ ...base, value: { type: "key", value: "sk_live_1" } })._tag).toBe("Failure")
  })
  test("a value is at most 16 KB and a fields credential has at most 20 fields (A43)", () => {
    const hosts = ["api.stripe.com"]
    expect(decodeCreate({ ...base, hosts, value: { type: "key", value: "x".repeat(16 * 1024) } })._tag).toBe("Success")
    expect(decodeCreate({ ...base, hosts, value: { type: "key", value: "x".repeat(16 * 1024 + 1) } })._tag).toBe(
      "Failure",
    )
    const fields = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`field${index}`, "v"]))
    expect(decodeCreate({ ...base, hosts, value: { type: "fields", fields: fields(20) } })._tag).toBe("Success")
    expect(decodeCreate({ ...base, hosts, value: { type: "fields", fields: fields(21) } })._tag).toBe("Failure")
  })
  test("an MCP_ label is refused, because only a connect makes MCP_ labels (K45)", () => {
    const value = { type: "key", value: "sk_live_1" }
    const hosts = ["api.stripe.com"]
    expect(decodeCreate({ ...base, label: "MCP_GMAIL", hosts, value })._tag).toBe("Failure")
    expect(decodeCreate({ ...base, label: "MCP", hosts, value })._tag).toBe("Success")
  })
  test("a client_credentials value takes a client id, a secret and an https token endpoint (§10c)", () => {
    const value = { type: "client_credentials", clientId: "id", clientSecret: "secret" }
    const hosts = ["acme.myshopify.com"]
    const tokenEndpoint = "https://acme.myshopify.com/admin/oauth/access_token"
    expect(decodeCreate({ ...base, hosts, value: { ...value, tokenEndpoint } })._tag).toBe("Success")
    expect(
      decodeCreate({ ...base, hosts, value: { ...value, tokenEndpoint: "http://acme.myshopify.com/token" } })._tag,
    ).toBe("Failure")
  })
  test("a pasted key decodes to a redacted value", () => {
    const decoded = Schema.decodeUnknownSync(Credential.CreateInput)({
      ...base,
      hosts: ["api.stripe.com"],
      value: { type: "key", value: "sk_live_1" },
    })
    expect(decoded.value.type === "key" && Redacted.value(decoded.value.value)).toBe("sk_live_1")
  })
})
