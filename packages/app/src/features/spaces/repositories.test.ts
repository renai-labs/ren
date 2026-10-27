import { describe, expect, test } from "bun:test"
import { Repositories } from "./repositories.js"

describe("Repositories.parse", () => {
  test("a pasted tree link gives the repository, the branch and the alias", () => {
    const parsed = Repositories.parse("https://github.com/acme/docs/tree/release")
    expect(parsed).toEqual({ repository: "https://github.com/acme/docs", name: "docs", branch: "release" })
    expect(Repositories.aliasFor(parsed?.name ?? "", [])).toBe("docs")
  })

  test("a nested GitLab tree link keeps every group and gives the branch", () => {
    expect(Repositories.parse("https://gitlab.com/acme/group/docs/-/tree/release")).toEqual({
      repository: "https://gitlab.com/acme/group/docs",
      name: "docs",
      branch: "release",
    })
  })

  test.each([
    ["https://github.com/acme/docs/blob/main/README.md", "https://github.com/acme/docs"],
    ["https://github.com/acme/docs/pulls", "https://github.com/acme/docs"],
    ["https://github.com/acme/docs.git", "https://github.com/acme/docs"],
    ["https://github.com/Acme/Docs?tab=readme-ov-file#install", "https://github.com/Acme/Docs"],
    ["git@github.com:acme/docs.git", "https://github.com/acme/docs"],
    ["github.com/acme/docs/", "https://github.com/acme/docs"],
    ["https://gitlab.com/acme/group/docs", "https://gitlab.com/acme/group/docs"],
    ["https://gitlab.com/acme/group/docs/-/merge_requests", "https://gitlab.com/acme/group/docs"],
  ])("cleans %s without a branch", (input, repository) => {
    expect(Repositories.parse(input)).toEqual({ repository, name: repository.split("/").at(-1) ?? "" })
  })

  test.each(["", "https://github.com/acme", "not a url"])("gives nothing for %s", (input) => {
    expect(Repositories.parse(input)).toBeUndefined()
  })
})

describe("Repositories.aliasFor", () => {
  test("a taken alias gets -2, then -3", () => {
    expect(Repositories.aliasFor("Docs", ["docs"])).toBe("docs-2")
    expect(Repositories.aliasFor("Docs", ["docs", "docs-2"])).toBe("docs-3")
  })
})

describe("Repositories.refusal", () => {
  test("a refused reference names its row; another failure names none", () => {
    expect(
      Repositories.refusal(
        Object.assign(new Error("the GitHub App cannot read"), {
          _tag: "InvalidRequestError",
          field: "references.api",
        }),
      ),
    ).toEqual({ alias: "api", message: "the GitHub App cannot read" })
    expect(Repositories.refusal(new Error("offline"))).toEqual({ message: "offline" })
  })
})
