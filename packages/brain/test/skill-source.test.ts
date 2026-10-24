import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { SkillSource } from "../src/skill/source.js"
import { TestGitHub } from "./lib/github.js"

const it = testEffect(Layer.empty)

const skill = (body: string) => `---\nname: PDF\ndescription: Fill PDF forms\n---\n${body}\n`

const source = (github: TestGitHub.Instance) =>
  SkillSource.make(github.hosts).pipe(Effect.provide(FetchHttpClient.layer))

it.live("reads SKILL.md at the commit that the default branch, a branch, a tag or a pinned commit names", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make()
    const first = yield* github.commit({ "skills/pdf/SKILL.md": skill("first") })
    yield* github.tag("v1", first)
    const next = yield* github.commit({ "skills/pdf/SKILL.md": skill("next") }, "next")
    const latest = yield* github.commit({ "skills/pdf/SKILL.md": skill("latest") })
    const skills = yield* source(github)
    const read = (ref?: string) => skills.resolve({ url: github.url, path: "skills/pdf", ...(ref && { ref }) })
    expect(yield* read()).toEqual({ commit: latest, document: skill("latest") })
    expect(yield* read("next")).toEqual({ commit: next, document: skill("next") })
    expect(yield* read("v1")).toEqual({ commit: first, document: skill("first") })
    const before = (yield* github.requests).length
    expect(yield* read(first)).toEqual({ commit: first, document: skill("first") })
    expect((yield* github.requests).slice(before).filter((request) => request.includes("info/refs"))).toEqual([])
  }),
)

it.live("a ref that is not in the repository fails and never falls back to the default branch", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make()
    yield* github.commit({ "SKILL.md": skill("root") })
    const skills = yield* source(github)
    const error = yield* skills.resolve({ url: github.url, ref: "missing", path: "." }).pipe(Effect.flip)
    expect(error.message).toBe(`The ref missing is not in ${github.url}`)
    expect(yield* skills.resolve({ url: `${github.url}.git/`, path: "." })).toMatchObject({ document: skill("root") })
  }),
)

it.live("a folder without SKILL.md and a repository outside GitHub fail with the reason", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make()
    const commit = yield* github.commit({ "other/README.md": "no skill" })
    const skills = yield* source(github)
    expect((yield* skills.resolve({ url: github.url, path: "other" }).pipe(Effect.flip)).message).toBe(
      `${github.url} has no other/SKILL.md at ${commit}`,
    )
    expect(
      (yield* skills.resolve({ url: "https://gitlab.com/acme/skills", path: "." }).pipe(Effect.flip)).message,
    ).toBe("Ren reads skills only from GitHub repositories, not https://gitlab.com/acme/skills")
  }),
)
