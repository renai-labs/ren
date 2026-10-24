import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { SkillCache } from "../src/skill/cache.js"
import { SkillSource } from "../src/skill/source.js"
import { TestGitHub } from "./lib/github.js"

const it = testEffect(Layer.empty)

const skill = (body: string) => `---\ndescription: Fill PDF forms\n---\n${body}\n`

const cacheOf = (github: TestGitHub.Instance) =>
  SkillSource.make(github.hosts).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.flatMap((source) => SkillCache.make(source, { refresh: "5 minutes" })),
  )

const refReads = (github: TestGitHub.Instance) =>
  Effect.map(github.requests, (requests) => requests.filter((request) => request.includes("info/refs")).length)

it.effect("reads a floating source again only after the refresh interval, and a pinned commit never", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make()
    const first = yield* github.commit({ "SKILL.md": skill("first") })
    const cache = yield* cacheOf(github)
    const floating = { url: github.url, path: "." }
    const pinned = { url: github.url, ref: first, path: "." }
    expect((yield* cache.resolve(floating)).commit).toBe(first)
    expect((yield* cache.resolve(pinned)).commit).toBe(first)
    const second = yield* github.commit({ "SKILL.md": skill("second") })
    expect((yield* cache.resolve(floating)).commit).toBe(first)
    expect(yield* refReads(github)).toBe(1)
    yield* TestClock.adjust("5 minutes")
    expect(yield* cache.resolve(floating)).toEqual({ commit: second, document: skill("second") })
    expect(yield* cache.resolve(pinned)).toEqual({ commit: first, document: skill("first") })
    expect((yield* github.requests).filter((request) => request.startsWith(`/raw/acme/skills/${first}`)).length).toBe(2)
  }),
)

it.effect("keeps the last good read when a later read fails, and a first read that fails fails", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make()
    const first = yield* github.commit({ "SKILL.md": skill("first") })
    const cache = yield* cacheOf(github)
    const floating = { url: github.url, path: "." }
    yield* cache.resolve(floating)
    yield* github.fail(true)
    yield* TestClock.adjust("5 minutes")
    expect((yield* cache.resolve(floating)).commit).toBe(first)
    expect((yield* cache.resolve({ url: github.url, ref: "main", path: "." }).pipe(Effect.flip)).message).toBe(
      `GitHub answered 503 for ${github.url}`,
    )
    yield* github.fail(false)
    const before = yield* refReads(github)
    expect((yield* cache.resolve({ url: github.url, ref: "main", path: "." }).pipe(Effect.flip)).message).toBe(
      `GitHub answered 503 for ${github.url}`,
    )
    expect(yield* refReads(github)).toBe(before)
    yield* TestClock.adjust("5 minutes")
    expect((yield* cache.resolve({ url: github.url, ref: "main", path: "." })).commit).toBe(first)
  }),
)

it.effect("reads a source once for callers that ask at the same time", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make()
    yield* github.commit({ "SKILL.md": skill("first") })
    const cache = yield* cacheOf(github)
    const reads = yield* Effect.all(
      Array.from({ length: 5 }, () => cache.resolve({ url: github.url, path: "." })),
      { concurrency: "unbounded" },
    )
    expect([new Set(reads.map((read) => read.commit)).size, yield* refReads(github)]).toEqual([1, 1])
  }),
)
