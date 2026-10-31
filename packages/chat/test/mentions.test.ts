import { describe, expect, test } from "bun:test"
import { Mentions } from "../src/mentions.js"

const general = Mentions.fromAgent({ id: "general", name: "General", mode: "subagent", hidden: false })
const explore = Mentions.fromAgent({
  id: "explore",
  name: "Explore",
  description: "Searches the codebase",
  mode: "subagent",
  hidden: false,
})
const notes = Mentions.fromSkill({ id: "release-notes", name: "Release notes" })
const plan = Mentions.fromFile({ path: "docs/plan.md", type: "file" })
const github = Mentions.fromApp({ id: "app_github", slug: "github", name: "GitHub", description: "Code hosting" })

describe("Mentions suggestions", () => {
  test("lists agents, then skills, then apps, then files, filtering names, descriptions of agents and skills, and not file search results", () => {
    expect(
      Mentions.suggest({ agents: [general, explore], skills: [notes], apps: [github], files: [plan], query: "" }).map(
        Mentions.key,
      ),
    ).toEqual(["agent:general", "agent:explore", "skill:release-notes", "app:app_github", "file:docs/plan.md"])
    expect(
      Mentions.suggest({
        agents: [general, explore],
        skills: [notes],
        apps: [github],
        files: [plan],
        query: "code",
      }).map(Mentions.key),
    ).toEqual(["agent:explore", "file:docs/plan.md"])
    expect(
      Mentions.suggest({ agents: [general, explore], skills: [notes], apps: [github], files: [], query: "git" }).map(
        Mentions.key,
      ),
    ).toEqual(["app:app_github"])
  })
})

describe("Mentions tokens", () => {
  test("replaces the @query with the mention and one space, and puts the caret after it", () => {
    expect(Mentions.insert("Ask @gen", general, 4, 8)).toEqual({ text: "Ask @  General ", cursor: 15 })
    expect(Mentions.insert("Ask @gen about it", general, 4, 8)).toEqual({ text: "Ask @  General about it", cursor: 14 })
  })

  test("finds mentions of known items only at word boundaries, preferring the longest label", () => {
    const longer = Mentions.fromAgent({ id: "general-2", name: "General-2", mode: "all", hidden: false })
    const text = "@  General-2 and @  General, not x@  General or @  Generally"
    expect(Mentions.tokens(text, [general, longer]).map((token) => [token.start, token.end, token.item.id])).toEqual([
      [0, 12, "general-2"],
      [17, 27, "general"],
    ])
    expect(Mentions.tokens(text, [])).toEqual([])
  })

  test("deletes a whole mention and the space after it with Backspace or Delete", () => {
    const text = "Ask @  General to look"
    const found = Mentions.tokens(text, [general])
    expect(Mentions.remove(text, found, { key: "Backspace", selectionStart: 14, selectionEnd: 14 })).toEqual({
      text: "Ask to look",
      cursor: 4,
    })
    expect(Mentions.remove(text, found, { key: "Delete", selectionStart: 8, selectionEnd: 8 })).toEqual({
      text: "Ask to look",
      cursor: 4,
    })
    expect(Mentions.remove(text, found, { key: "Delete", selectionStart: 14, selectionEnd: 14 })).toBeUndefined()
    expect(Mentions.remove(text, found, { key: "Backspace", selectionStart: 4, selectionEnd: 14 })).toBeUndefined()
  })

  test("sends mentions as @id with their ranges, agents and skills once each, and files as plain paths", () => {
    const text = "@  General read @  docs/plan.md with @  Release notes, then @  General again"
    expect(Mentions.resolve(text, Mentions.tokens(text, [general, notes, plan]))).toEqual({
      text: "@general read @docs/plan.md with @release-notes, then @general again",
      agents: [{ name: "general", mention: { start: 0, end: 8, text: "@general" } }],
      skills: [{ id: "release-notes", mention: { start: 33, end: 47, text: "@release-notes" } }],
    })
    expect(Mentions.resolve("Plain text", [])).toEqual({ text: "Plain text" })
  })
})
