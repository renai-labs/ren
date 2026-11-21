import { describe, expect, test } from "bun:test"
import { Repositories } from "../src/index.js"

const listing = {
  installed: true,
  repositories: [
    { url: "https://github.com/ren/web", name: "ren/web", description: "The web app" },
    { url: "https://github.com/ren/api", name: "ren/api" },
  ],
}

const parsed = (url: string) => {
  const result = Repositories.parse(url)
  if (!result) throw new Error(`Not a repository: ${url}`)
  return result
}

describe("Repositories picker", () => {
  test("lists the repositories that are not in the space yet", () => {
    const known = Repositories.knownOf([{ repository: "https://github.com/Ren/Web" }])
    expect(Repositories.candidates([listing], known).map((row) => row.name)).toEqual(["ren/api"])
  })

  test("a pasted link to a listed repository keeps the listed description and takes the pasted branch", () => {
    const listed = Repositories.candidates([listing], new Set())
    const picked = Repositories.paste(new Map(), parsed("https://github.com/ren/web/tree/dev"), listed)
    expect(picked.get("https://github.com/ren/web")).toEqual({
      parsed: { repository: "https://github.com/ren/web", name: "web", branch: "dev" },
      description: "The web app",
    })
  })

  test("picked repositories that the listing does not show stay in the rows, first", () => {
    const listed = Repositories.candidates([listing], new Set())
    const picked = Repositories.paste(new Map(), parsed("https://github.com/other/tool"), listed)
    expect(Repositories.rows(listed, picked).map((row) => row.name)).toEqual(["other/tool", "ren/web", "ren/api"])
  })

  test("gives each added repository a free alias", () => {
    const picked = new Map(
      ["https://github.com/a/web", "https://github.com/b/web"].map((repository) => [
        repository,
        { parsed: { repository, name: "web" }, description: "" },
      ]),
    )
    expect(Repositories.referencesOf(picked, [{ alias: "web" }]).map((reference) => reference.alias)).toEqual([
      "web-2",
      "web-3",
    ])
  })
})
