import { describe, expect, test } from "bun:test"
import type { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { DateTime, Effect, Redacted, Result } from "effect"
import { TestClock } from "effect/testing"
import { Credentials } from "../src/harness/opencode/credentials.js"
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
  methodID: RenPlugin.method,
  access: "sk-ren",
  refresh: "",
  expires,
})

describe("whether a credential replaces the stored one", () => {
  test.each<[string, Credential.Value, Credential.Value, boolean]>([
    ["the same key keeps it", key("sk-1"), key("sk-1"), false],
    ["another key replaces it", key("sk-1"), key("sk-2"), true],
    ["an oauth credential replaces a key", key("sk-1"), oauth(1_000), true],
    ["oauth under the same method that expires at the same time keeps it", oauth(5_000), oauth(5_000, "other"), false],
    ["oauth under the same method that expires one millisecond later replaces it", oauth(5_000), oauth(5_001), true],
  ])("%s", (_name, stored, next, expected) => {
    expect(Credentials.replaces(stored, next)).toBe(expected)
  })
})

describe("the ren method's refresh", () => {
  test.each<[string, number, Result.Result<Credential.OAuth, RenPlugin.ManagedKeyError>]>([
    ["returns the credential unchanged one millisecond before the expiry", 59_999, Result.succeed(managed(60_000))],
    [
      "fails at the expiry, naming the provider and the expiry",
      60_000,
      Result.fail(
        new RenPlugin.ManagedKeyError({
          message: "The model key for endpoint litellm expired at 1970-01-01T00:01:00.000Z",
        }),
      ),
    ],
  ])("without a refreshed key, it %s", async (_name, now, expected) => {
    expect(
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* TestClock.setTime(now)
          return yield* RenPlugin.refresh("litellm", managed(60_000), () => Effect.succeedNone)
        }).pipe(Effect.provide(TestClock.layer()), Effect.result),
      ),
    ).toEqual(expected)
  })

  test.each<[string, number | undefined, number]>([
    ["expires later", 3_600_000, 3_600_000],
    ["expires earlier", 30_000, 30_000],
    ["never expires", undefined, Number.MAX_SAFE_INTEGER],
  ])("takes a refreshed key that %s in place of the expiring one", async (_name, expiresAt, expires) => {
    const refreshed = await Effect.runPromise(
      RenPlugin.refresh("litellm", managed(60_000), () =>
        Effect.succeedSome({
          key: Redacted.make("refreshed"),
          ...(expiresAt !== undefined && { expiresAt: DateTime.makeUnsafe(expiresAt) }),
        }),
      ),
    )
    expect(refreshed).toEqual({ ...managed(expires), access: "refreshed" })
  })
})
