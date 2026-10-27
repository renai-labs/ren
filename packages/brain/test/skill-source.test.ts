import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect, Layer } from "effect"
import { SkillSource } from "../src/skill/source.js"
import { TestGitHub } from "./lib/github.js"

const it = testEffect(Layer.empty)

const skill = (body: string) => `---\nname: PDF\ndescription: Fill PDF forms\n---\n${body}\n`

const source = (github: TestGitHub.Instance) => TestGitHub.hostsOf(github).pipe(Effect.map(SkillSource.make))

const read = (resolved: SkillSource.Resolved) => ({ commit: resolved.lookup.commit, document: resolved.document })

it.live("reads SKILL.md at the commit that the default branch, a branch, a tag or a pinned commit names", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make()
    const first = yield* github.commit({ "skills/pdf/SKILL.md": skill("first") })
    yield* github.tag("v1", first)
    const next = yield* github.commit({ "skills/pdf/SKILL.md": skill("next") }, "next")
    const latest = yield* github.commit({ "skills/pdf/SKILL.md": skill("latest") })
    const skills = yield* source(github)
    const resolve = (ref?: string) =>
      skills.resolve({ url: github.url, path: "skills/pdf", ...(ref && { ref }) }).pipe(Effect.map(read))
    expect(yield* resolve()).toEqual({ commit: latest, document: skill("latest") })
    expect(yield* resolve("next")).toEqual({ commit: next, document: skill("next") })
    expect(yield* resolve("v1")).toEqual({ commit: first, document: skill("first") })
    expect(yield* resolve(first)).toEqual({ commit: first, document: skill("first") })
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
    ).toBe("Ren reads only repositories on github.com, not https://gitlab.com/acme/skills")
  }),
)
