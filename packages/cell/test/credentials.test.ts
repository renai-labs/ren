import { describe, expect, test } from "bun:test"
import type { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Effect, Result } from "effect"
import { TestClock } from "effect/testing"
import { Credentials } from "../src/harness/opencode/credentials.js"
import { RenPlugin } from "../src/harness/opencode/plugin.js"

const key = (value: string, configuration?: Record<string, string>): Credential.Value => ({
  type: "key",
  key: value,
  ...(configuration && { configuration }),
})

const oauth = (expires: number, access = "access", method = "chatgpt-browser"): Credential.Value => ({
  type: "oauth",
  methodID: IntegrationMethodID.make(method),
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
    ["the same key and configuration keeps it", key("sk-1", { region: "eu" }), key("sk-1", { region: "eu" }), false],
    ["another key replaces it", key("sk-1"), key("sk-2"), true],
    [
      "the same key with other configuration replaces it",
      key("sk-1", { region: "eu" }),
      key("sk-1", { region: "us" }),
      true,
    ],
    ["an oauth credential replaces a key", key("sk-1"), oauth(1_000), true],
    ["a key replaces an oauth credential", oauth(1_000), key("sk-1"), true],
    [
      "oauth under another method replaces it, even when it expires earlier",
      oauth(5_000),
      oauth(1_000, "access", "ren"),
      true,
    ],
    ["oauth under the same method that expires earlier keeps it", oauth(5_000), oauth(4_000), false],
    ["oauth under the same method that expires at the same time keeps it", oauth(5_000), oauth(5_000), false],
    ["oauth with another access token but the same expiry keeps it", oauth(5_000), oauth(5_000, "other"), false],
    ["oauth under the same method that expires later replaces it", oauth(5_000), oauth(6_000), true],
  ])("%s", (_name, stored, next, expected) => {
    expect(Credentials.replaces(stored, next)).toBe(expected)
  })
})

describe("the ren method's refresh", () => {
  const run = (now: number, expires: number) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(now)
        return yield* RenPlugin.refresh("litellm", managed(expires))
      }).pipe(Effect.provide(TestClock.layer()), Effect.result),
    )

  test.each<[string, number, number]>([
    ["well before expiry", 0, 10 * 60_000],
    ["inside OpenCode's 5-minute refresh window", 0, 60_000],
    ["one millisecond before expiry", 59_999, 60_000],
  ])("returns the credential unchanged %s", async (_name, now, expires) => {
    expect(await run(now, expires)).toEqual(Result.succeed(managed(expires)))
  })

  test.each<[string, number]>([
    ["at the expiry", 60_000],
    ["after the expiry", 90_000],
  ])("fails %s, naming the provider and the expiry", async (_name, now) => {
    expect(await run(now, 60_000)).toEqual(
      Result.fail(
        new RenPlugin.ManagedKeyError({
          message: "The model key for provider litellm expired at 1970-01-01T00:01:00.000Z",
        }),
      ),
    )
  })
})
