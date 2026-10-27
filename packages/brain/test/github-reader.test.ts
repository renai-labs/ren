import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect, Fiber, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { FetchHttpClient } from "effect/http"
import { GitHubReader } from "../src/github/reader.js"
import { TestGitHub } from "./lib/github.js"

const it = testEffect(Layer.empty)

const readerOf = (github: TestGitHub.Instance) =>
  GitHubReader.make(Effect.succeed(github.hosts)).pipe(Effect.provide(FetchHttpClient.layer))

const basic = `Basic ${btoa("x-access-token:ren:GITHUB")}`

it.live("reads a public repository without a token, and a private one with the placeholder after GitHub refuses", () =>
  Effect.gen(function* () {
    const open = yield* TestGitHub.make({ repo: "open" })
    yield* open.commit({ "README.md": "open" })
    const openLookup = yield* (yield* readerOf(open)).lookup(open.url)
    expect(openLookup.access).toBe("anonymous")
    expect((yield* open.authorizations).map((request) => request[1])).toEqual([null])

    const closed = yield* TestGitHub.make({ repo: "closed", isPrivate: true })
    const commit = yield* closed.commit({ "README.md": "closed" })
    const reader = yield* readerOf(closed)
    const lookup = yield* reader.lookup(closed.url)
    expect(lookup).toMatchObject({ commit, access: "placeholder" })
    expect(yield* reader.read(lookup, "README.md")).toEqual(Option.some("closed"))
    expect(reader.archive(lookup)).toEqual({
      url: `${closed.hosts.api}/repos/acme/closed/tarball/${commit}`,
      headers: { authorization: "Bearer ren:GITHUB" },
    })
    expect((yield* closed.authorizations).map((request) => request[1])).toEqual([null, basic, "Bearer ren:GITHUB"])
  }),
)

it.live("a lookup that fails with the placeholder names its cause", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make({ repo: "docs", isPrivate: true })
    yield* github.commit({ "README.md": "docs" })
    const reader = yield* readerOf(github)
    const causeOf = (placeholder: TestGitHub.Placeholder) =>
      github.answer(placeholder).pipe(
        Effect.andThen(reader.lookup(github.url)),
        Effect.flip,
        Effect.map((error) => error.message),
      )
    expect(yield* causeOf("no_egress")).toBe(
      "this runtime has no egress, so Ren cannot read private repositories here, or acme/docs does not exist",
    )
    expect(yield* causeOf("no_credential")).toBe(
      "this space has no GitHub credential: install the GitHub App or sign in with GitHub, or acme/docs does not exist",
    )
    expect(yield* causeOf("no_access")).toBe(
      "the GitHub App cannot read acme/docs: add the repository to the installation, or acme/docs does not exist",
    )
  }),
)

it.live("a lookup asks git protocol v2 only for the refs it needs, and finds a branch and an annotated tag", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make({ repo: "docs" })
    const head = yield* github.commit({ "README.md": "main" })
    const release = yield* github.commit({ "README.md": "release" }, "release")
    const next = yield* github.commit({ "README.md": "next" }, "release-next")
    yield* github.tag("v1", head)
    const reader = yield* readerOf(github)
    expect((yield* reader.lookup(github.url)).commit).toBe(head)
    expect((yield* reader.lookup(github.url, "release")).commit).toBe(release)
    expect((yield* reader.lookup(github.url, "release-next")).commit).toBe(next)
    expect((yield* reader.lookup(github.url, "v1")).commit).toBe(head)
    expect((yield* reader.lookup(github.url, "releas").pipe(Effect.flip)).message).toBe(
      `The ref releas is not in ${github.url}`,
    )
    expect(yield* github.bodies).toEqual([
      ["ref-prefix HEAD"],
      ["ref-prefix refs/heads/release", "ref-prefix refs/tags/release"],
      ["ref-prefix refs/heads/release-next", "ref-prefix refs/tags/release-next"],
      ["ref-prefix refs/heads/v1", "ref-prefix refs/tags/v1"],
      ["ref-prefix refs/heads/releas", "ref-prefix refs/tags/releas"],
    ])
  }),
)

it.effect("a read of a file that GitHub does not answer fails after 15 s", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make({ repo: "docs" })
    yield* github.commit({ "README.md": "docs" })
    const reader = yield* readerOf(github)
    const lookup = yield* reader.lookup(github.url)
    yield* github.hold
    const read = yield* Effect.forkChild(Effect.flip(reader.read(lookup, "README.md")))
    yield* github.arrived
    yield* TestClock.adjust("15 seconds")
    expect((yield* Fiber.join(read)).message).toBe(
      `GitHub did not answer within 15s for ${github.url}/README.md`,
    )
  }),
)
