import { describe, expect, test } from "bun:test"
import type { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { DateTime, Effect, Redacted, Result } from "effect"
import { TestClock } from "effect/testing"
import { Credentials } from "../src/harness/opencode/credentials.js"
import { ModelCredentials } from "../src/harness/opencode/model-credentials.js"
import { RenPlugin } from "../src/harness/opencode/plugin.js"

const key = (value: string): Credential.Value => ({ type: "key", key: value })

const oauth = (expires: number, access = "access"): Credential.Value => ({
  type: "oauth",
  methodID: IntegrationMethodID.make("chatgpt-browser"),
  access,
  refresh: "refresh",
  expires,
})

const managed = (expires: number) => ({
  type: "oauth" as const,
  methodID: ModelCredentials.method,
  access: "sk-ren",
  refresh: "",
  expires,
})

describe("whether a credential replaces the stored one", () => {
  test.each<[string, Credential.Value, Credential.Value, boolean]>([
    ["the same key keeps it", key("sk-1"), key("sk-1"), false],
    ["another key replaces it", key("sk-1"), key("sk-2"), true],
    ["an oauth credential replaces a key", key("sk-1"), oauth(1_000), true],
    ["oauth under the same method with another key replaces it", oauth(5_000), oauth(1_000, "other"), true],
    ["oauth with the same key that OpenCode asks to renew earlier keeps it", oauth(5_000), oauth(1_000), false],
    ["oauth under the same method that expires one millisecond later replaces it", oauth(5_000), oauth(5_001), true],
  ])("%s", (_name, stored, next, expected) => {
    expect(Credentials.replaces(stored, next)).toBe(expected)
  })
})

describe("the ren method's refresh", () => {
  test("without a key from Ren it fails, naming the endpoint", async () => {
    expect(
      await Effect.runPromise(
        RenPlugin.refresh("litellm", managed(60_000), () => Effect.succeedNone).pipe(Effect.result),
      ),
    ).toEqual(
      Result.fail(
        new RenPlugin.ManagedKeyError({
          message: "The model key for endpoint litellm expired, and Ren gave no new key",
        }),
      ),
    )
  })

  test.each<[string, number | undefined, number]>([
    ["expires in 6 hours: OpenCode asks again at the start of its 3 hour window", 21_600_000, 11_100_000],
    ["is already in its window: OpenCode asks again a minute after its own margin", 3_600_000, 360_000],
    ["expires in 30 seconds: OpenCode asks again at its expiry", 30_000, 30_000],
    ["never expires", undefined, Number.MAX_SAFE_INTEGER],
  ])("takes a key from Ren that %s", async (_name, expiresAt, expires) => {
    const refreshed = await Effect.runPromise(
      RenPlugin.refresh("litellm", managed(60_000), () =>
        Effect.succeedSome({
          key: Redacted.make("refreshed"),
          ...(expiresAt !== undefined && { expiresAt: DateTime.makeUnsafe(expiresAt) }),
        }),
      ).pipe(Effect.provide(TestClock.layer())),
    )
    expect(refreshed).toEqual({ ...managed(expires), access: "refreshed" })
  })
})
