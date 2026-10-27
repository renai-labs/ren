import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect, Fiber, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { GitHubReader } from "../src/github/reader.js"
import { ReferenceCache } from "../src/reference/cache.js"
import { TestGitHub } from "./lib/github.js"

const it = testEffect(Layer.empty)

const cacheOf = (github: TestGitHub.Instance) =>
  GitHubReader.make(Effect.succeed(github.hosts)).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.flatMap((reader) => ReferenceCache.make(reader)),
  )

const refReads = (github: TestGitHub.Instance) =>
  Effect.map(github.requests, (requests) => requests.filter((request) => request.includes("git-upload-pack")).length)

it.effect(
  "looks a branch up again after 1 day, and a failed lookup after 1 minute with the last good commit kept",
  () =>
    Effect.gen(function* () {
      const github = yield* TestGitHub.make({ repo: "docs" })
      const first = yield* github.commit({ "README.md": "first" })
      const cache = yield* cacheOf(github)
      const docs = { repository: github.url }
      expect((yield* cache.resolve(docs)).commit).toBe(first)
      const second = yield* github.commit({ "README.md": "second" })
      yield* TestClock.adjust("23 hours")
      expect((yield* cache.resolve(docs)).commit).toBe(first)
      yield* TestClock.adjust("1 hour")
      expect((yield* cache.resolve(docs)).commit).toBe(second)
      yield* github.fail(true)
      yield* TestClock.adjust("1 day")
      expect((yield* cache.resolve(docs)).commit).toBe(second)
      yield* github.fail(false)
      const third = yield* github.commit({ "README.md": "third" })
      yield* TestClock.adjust("1 minute")
      expect((yield* cache.resolve(docs)).commit).toBe(third)
    }),
)

it.effect("a lookup that failed succeeds 1 minute after the cause is fixed, with no restart", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make({ repo: "docs", isPrivate: true })
    const commit = yield* github.commit({ "README.md": "docs" })
    yield* github.answer("no_credential")
    const cache = yield* cacheOf(github)
    const docs = { repository: github.url, branch: "main" }
    expect((yield* cache.resolve(docs).pipe(Effect.flip)).message).toContain("this space has no GitHub credential")
    yield* github.answer("accepted")
    const before = yield* refReads(github)
    expect((yield* cache.resolve(docs).pipe(Effect.flip)).message).toContain("this space has no GitHub credential")
    expect(yield* refReads(github)).toBe(before)
    yield* TestClock.adjust("1 minute")
    expect(yield* cache.resolve(docs)).toMatchObject({ commit, access: "placeholder" })
  }),
)

it.effect("GitHub does not answer: after 15 s the last good commit stays, and a lookup 1 minute later succeeds", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make({ repo: "docs" })
    const first = yield* github.commit({ "README.md": "first" })
    const cache = yield* cacheOf(github)
    const docs = { repository: github.url }
    yield* cache.resolve(docs)
    const second = yield* github.commit({ "README.md": "second" })
    yield* TestClock.adjust("1 day")
    yield* github.hold
    const held = yield* Effect.forkChild(cache.resolve(docs))
    yield* github.arrived
    yield* TestClock.adjust("15 seconds")
    expect((yield* Fiber.join(held)).commit).toBe(first)
    yield* github.release
    yield* TestClock.adjust("1 minute")
    expect((yield* cache.resolve(docs)).commit).toBe(second)
  }),
)
