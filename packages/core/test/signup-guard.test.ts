import { describe, expect } from "bun:test"
import { AuthDatabase } from "@ren/db/auth-database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { ConfigProvider, Effect, Fiber, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { SignupGuard } from "../src/signup-guard.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(
  Layer.mergeAll(
    Testing.layer,
    ConfigProvider.layerAdd(
      ConfigProvider.fromUnknown({
        SIGNUP_ALLOWED_DOMAINS: "mailinator.com,lab.dev",
        SIGNUP_BLOCKED_DOMAINS: "acme.io",
      }),
      { asPrimary: true },
    ),
  ),
)

const fail = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }))

const resolver = (overrides: Partial<SignupGuard.Resolver>): SignupGuard.Resolver => ({
  resolveMx: () => Promise.resolve([{ exchange: "mx.example.com" }]),
  resolve4: fail("ENODATA"),
  resolve6: fail("ENODATA"),
  ...overrides,
})

const code = Effect.fnUntraced(function* (email: string, overrides: Partial<SignupGuard.Resolver> = {}) {
  const guard = yield* SignupGuard.make(resolver(overrides))
  return Option.getOrUndefined(yield* guard.checkEmailSignUp(email))?.code
})

const insertUser = Effect.fnUntraced(function* (email: string) {
  const database = yield* AuthDatabase.Service
  yield* Effect.promise(() =>
    database.db.insert(AuthDatabase.Schema.user).values({
      id: Auth.UserID.create(),
      name: "Owner",
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  )
})

describe("SignupGuard", () => {
  describe("disposable domains", () => {
    it.live("rejects listed domains and their subdomains", () =>
      Effect.gen(function* () {
        expect(yield* code("spam@guerrillamail.com")).toBe("DISPOSABLE_EMAIL")
        expect(yield* code("spam@inbox.guerrillamail.com")).toBe("DISPOSABLE_EMAIL")
      }),
    )

    it.live("lets privacy relays and regular providers through", () =>
      Effect.gen(function* () {
        for (const domain of ["duck.com", "relay.firefox.com", "simplelogin.com", "proton.me", "gmail.com"]) {
          expect(yield* code(`someone@${domain}`)).toBeUndefined()
        }
      }),
    )

    it.live("applies the configured allow and block lists first", () =>
      Effect.gen(function* () {
        expect(yield* code("tester@mailinator.com")).toBeUndefined()
        expect(yield* code("someone@eu.acme.io")).toBe("DISPOSABLE_EMAIL")
      }),
    )

    it.live("checks accounts created outside email sign-up for disposable domains only", () =>
      Effect.gen(function* () {
        const guard = yield* SignupGuard.make(resolver({ resolveMx: fail("ENOTFOUND") }))
        expect(Option.getOrUndefined(yield* guard.checkAccountCreation("oauth@guerrillamail.com"))?.code).toBe(
          "DISPOSABLE_EMAIL",
        )
        expect(Option.isNone(yield* guard.checkAccountCreation("oauth@nowhere.dev"))).toBe(true)
      }),
    )
  })

  describe("mail server lookup", () => {
    it.live("accepts a domain with MX records", () =>
      Effect.gen(function* () {
        expect(yield* code("ada@acme.dev")).toBeUndefined()
      }),
    )

    it.live("rejects a null MX and a domain that does not exist", () =>
      Effect.gen(function* () {
        expect(yield* code("ada@acme.dev", { resolveMx: () => Promise.resolve([{ exchange: "" }]) })).toBe(
          "UNDELIVERABLE_EMAIL_DOMAIN",
        )
        expect(yield* code("ada@acme.dev", { resolveMx: () => Promise.resolve([{ exchange: "." }]) })).toBe(
          "UNDELIVERABLE_EMAIL_DOMAIN",
        )
        expect(yield* code("ada@acme.dev", { resolveMx: fail("ENOTFOUND") })).toBe("UNDELIVERABLE_EMAIL_DOMAIN")
      }),
    )

    it.live("falls back to address records when there is no MX", () =>
      Effect.gen(function* () {
        expect(
          yield* code("ada@acme.dev", { resolveMx: fail("ENODATA"), resolve6: () => Promise.resolve(["::1"]) }),
        ).toBe(undefined)
        expect(
          yield* code("ada@acme.dev", {
            resolveMx: () => Promise.resolve([]),
            resolve4: () => Promise.resolve(["192.0.2.1"]),
          }),
        ).toBe(undefined)
        expect(yield* code("ada@acme.dev", { resolveMx: fail("ENODATA") })).toBe("UNDELIVERABLE_EMAIL_DOMAIN")
      }),
    )

    it.live("skips the lookup for allowed domains", () =>
      Effect.gen(function* () {
        expect(yield* code("ada@lab.dev", { resolveMx: fail("ENOTFOUND") })).toBeUndefined()
      }),
    )

    it.live("fails open on DNS errors", () =>
      Effect.gen(function* () {
        expect(yield* code("ada@acme.dev", { resolveMx: fail("ESERVFAIL") })).toBeUndefined()
      }),
    )

    it.effect("fails open when the lookup times out", () =>
      Effect.gen(function* () {
        const pending = yield* Effect.forkChild(code("ada@acme.dev", { resolveMx: () => new Promise(() => {}) }))
        yield* TestClock.adjust("1500 millis")
        expect(yield* Fiber.join(pending)).toBeUndefined()
      }),
    )
  })

  describe("email aliases", () => {
    it.live("rejects plus tags everywhere and Gmail dots of an existing inbox", () =>
      Effect.gen(function* () {
        yield* insertUser("jdoe@gmail.com")
        yield* insertUser("owner@acme-tools.dev")
        for (const alias of [
          "jdoe+1@gmail.com",
          "j.doe@googlemail.com",
          "J.Doe+farm@GoogleMail.com",
          "owner+x@acme-tools.dev",
        ]) {
          expect(yield* code(alias)).toBe("ALIAS_EMAIL")
        }
      }),
    )

    it.live("keeps exact duplicates and distinct inboxes out of it", () =>
      Effect.gen(function* () {
        yield* insertUser("grace@gmail.com")
        expect(yield* code("grace@gmail.com")).toBeUndefined()
        expect(yield* code("gracex@gmail.com")).toBeUndefined()
        expect(yield* code("g.race@acme-tools.dev")).toBeUndefined()
      }),
    )
  })
})
