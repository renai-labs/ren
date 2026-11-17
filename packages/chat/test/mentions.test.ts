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
  test("inserts a file at the cursor and separates it from the previous word", () => {
    expect(Mentions.insertFile("Read", "src/app.ts", 4)).toEqual({ text: "Read @  src/app.ts ", cursor: 19 })
    expect(Mentions.insertFile("Read more", "src/app.ts", 5)).toEqual({
      text: "Read @  src/app.ts more",
      cursor: 19,
    })
    expect(Mentions.insertFile("", "src/app.ts", 0)).toEqual({ text: "@  src/app.ts ", cursor: 14 })
  })
  test("inserts an app at the cursor like a file", () => {
    const app = Mentions.fromApp({ id: "app_1", slug: "github", name: "GitHub", description: "" })
    expect(Mentions.insertAt("Review", app, 6)).toEqual({ text: "Review @  GitHub ", cursor: 17 })
    expect(Mentions.insertAt("", app, 0)).toEqual({ text: "@  GitHub ", cursor: 10 })
  })
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

describe("Mentions on a keyboard without key events", () => {
  const text = "Ask @  General now"
  const found = Mentions.tokens(text, [general])

  test("a character deleted inside a mention removes the whole mention and the space after it", () => {
    expect(Mentions.unmention(text, "Ask @  Genera now", found)).toEqual({ text: "Ask now", cursor: 4 })
    expect(Mentions.unmention(text, "Ask @ General now", found)).toEqual({ text: "Ask now", cursor: 4 })
  })

  test("a deletion that spans a mention and more removes all of it", () => {
    expect(Mentions.unmention(text, "Ask  now", found)).toEqual({ text: "Ask now", cursor: 4 })
    expect(Mentions.unmention(text, "As", found)).toEqual({ text: "As", cursor: 2 })
  })

  test("leaves typing, deletions outside a mention and the space after a mention alone", () => {
    expect(Mentions.unmention(text, "Ask @  General nowx", found)).toBeUndefined()
    expect(Mentions.unmention(text, "Ask @  General no", found)).toBeUndefined()
    expect(Mentions.unmention(text, "Ask @  Generalnow", found)).toBeUndefined()
    expect(Mentions.unmention(text, "sk @  General now", found)).toBeUndefined()
    expect(Mentions.unmention(text, "Ask @  Generaq now", found)).toBeUndefined()
  })
})

describe("Mentions groups", () => {
  const app = (name: string) => Mentions.fromApp({ id: `app_${name}`, slug: name, name, description: "" })
  const repository = Mentions.fromRepository({
    alias: "gitweb",
    repository: "https://github.com/ren/web",
    description: "",
  })

  test("names the apps and repositories by label or handle, and takes every file the search found", () => {
    const apps = [app("GitHub"), app("Linear"), app("Gitea")]
    const files = [plan, Mentions.fromFile({ path: "src/app.ts", type: "file" })]
    expect(
      Mentions.group("git", { apps, repositories: [repository], files }).map((entry) => [entry.group, entry.item.id]),
    ).toEqual([
      ["Apps", "app_GitHub"],
      ["Apps", "app_Gitea"],
      ["Repositories", "gitweb"],
      ["Files", "docs/plan.md"],
      ["Files", "src/app.ts"],
    ])
    expect(repository.label).toBe("ren/web")
  })

  test("shows at most five of each group", () => {
    const apps = Array.from({ length: 8 }, (_, index) => app(`app-${index}`))
    const files = Array.from({ length: 8 }, (_, index) => Mentions.fromFile({ path: `f${index}.ts`, type: "file" }))
    const listed = Mentions.group("", { apps, repositories: [], files })
    expect(listed.filter((entry) => entry.group === "Apps")).toHaveLength(5)
    expect(listed.filter((entry) => entry.group === "Files")).toHaveLength(5)
  })

  test("finds a file mention that is already in the text by its pill", () => {
    const found = Mentions.scan("Read @  src/app.ts and @  General", [general])
    expect(found.map((token) => Mentions.key(token.item))).toEqual(["file:src/app.ts", "agent:general"])
  })
})
