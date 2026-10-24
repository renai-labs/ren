import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { AppProfile } from "../src/app-profile.js"
import { Credential } from "../src/credential.js"

const isSlug = Schema.is(AppProfile.Slug)
const isEnv = Schema.is(Credential.Env)
const decodeCreate = Schema.decodeUnknownExit(Credential.CreateInput)

describe("AppProfile", () => {
  test("a profile slug has at most 32 characters, so MCP_<MCP>__<SLUG> fits in 128 (P7, §8 rule 4)", () => {
    expect(isSlug("a".repeat(32))).toBe(true)
    expect(isSlug("a".repeat(33))).toBe(false)
  })

  test("an app env key has at most 94 characters and holds no __, so every __ in a label marks the slug (§8 rule 4)", () => {
    const env = (name: string) => ({ kind: "env", name, optional: false })
    expect(isEnv(env(`A${"B".repeat(93)}`))).toBe(true)
    expect(isEnv(env(`A${"B".repeat(94)}`))).toBe(false)
    expect(isEnv(env("SHOPIFY__TOKEN"))).toBe(false)
  })

  test("a loose label with __ is refused, because __ belongs to profiles (§8 rule 10)", () => {
    const loose = (label: string) =>
      decodeCreate({
        owner: { kind: "org" },
        label,
        hosts: ["api.stripe.com"],
        value: { type: "key", value: "sk_live_1" },
      })._tag
    expect(loose("STRIPE_KEY__ACME")).toBe("Failure")
    expect(loose("STRIPE_KEY_ACME")).toBe("Success")
  })
})
