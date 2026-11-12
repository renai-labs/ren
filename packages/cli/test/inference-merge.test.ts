import { describe, expect, test } from "bun:test"
import { Merge } from "../src/inference/merge.js"

const target = { kind: "opencode-user-configuration" } as const

const base = { description: "", containsSecret: false, target }

describe("json and jsonc", () => {
  const existing = `{
  // my own provider
  "provider": { "mine": { "name": "Mine" } },
  "model": "mine/big"
}
`

  test("adds a provider without disturbing comments or sibling keys", () => {
    const merged = Merge.apply(
      existing,
      { ...base, kind: "set-object-path", keyPath: ["provider", "ren"], value: { name: "Ren" } },
      "jsonc",
    )
    expect(merged).toContain("// my own provider")
    expect(merged).toContain('"name": "Mine"')
    expect(merged).toContain('"model": "mine/big"')
    expect(merged).toContain('"ren": {')
  })

  test("is idempotent: a second run changes nothing", () => {
    const operation = {
      ...base,
      kind: "set-object-path",
      keyPath: ["provider", "ren"],
      value: { name: "Ren" },
    } as const
    const once = Merge.apply(existing, operation, "jsonc") ?? ""
    expect(Merge.apply(once, operation, "jsonc")).toBe(once)
  })

  test("handles an empty or absent file", () => {
    expect(Merge.apply("", { ...base, kind: "set-object-path", keyPath: ["env", "A"], value: "1" }, "json")).toContain(
      '"A": "1"',
    )
  })
})

describe("toml", () => {
  const existing = `model = "o3"

# my provider
[model_providers.mine]
name = "Mine"

[[mcp_servers]]
name = "one"

# Ren's provider
[model_providers.ren]
name = "Old"

# the next table
[profiles.mine]
model = "o3"
`

  test("replaces its own table on a re-run and keeps every other table, array tables and comments", () => {
    const merged = Merge.upsertTomlTable(existing, "model_providers.ren", { name: "Ren", base_url: "https://ren" })
    expect(merged).not.toContain('name = "Old"')
    expect(merged).toContain("# my provider\n[model_providers.mine]")
    expect(merged).toContain("[[mcp_servers]]")
    expect(merged).toContain("# the next table\n[profiles.mine]")
    expect(merged.endsWith('[model_providers.ren]\nname = "Ren"\nbase_url = "https://ren"\n')).toBe(true)
    expect(Merge.upsertTomlTable(merged, "model_providers.ren", { name: "Ren", base_url: "https://ren" })).toBe(merged)
  })

  test("splits a document at its headers, array sections included", () => {
    expect(Merge.tomlBlocks(existing).map((block) => block.name)).toEqual([
      null,
      "model_providers.mine",
      "mcp_servers",
      "model_providers.ren",
      "profiles.mine",
    ])
  })

  test("renders a file Ren owns with its top-level keys first", () => {
    expect(Merge.renderToml({ model: "ren/x", model_providers: { name: "Ren" } })).toBe(
      'model = "ren/x"\n\n[model_providers]\nname = "Ren"\n',
    )
  })
})

describe("yaml", () => {
  const existing = `model: mine
custom_providers:
  - name: mine
    base_url: https://mine
`

  test("appends its provider and keeps the person's, then replaces its own entry on a re-run", () => {
    const first = Merge.appendYamlItem(existing, "custom_providers", { key: "name", value: "ren" }, { name: "ren" })
    const second = Merge.appendYamlItem(
      first,
      "custom_providers",
      { key: "name", value: "ren" },
      { name: "ren", base_url: "https://ren" },
    )
    expect(second).toContain("name: mine")
    expect(second.match(/name: ren/gu)).toHaveLength(1)
    expect(second).toContain("base_url: https://ren")
  })

  test("writes block style into a file that did not exist", () => {
    expect(Merge.setYaml("", ["model", "default"], "ren/x")).toBe("model:\n  default: ren/x\n")
  })
})

describe("dotenv", () => {
  test("replaces a variable in place and keeps comments and other variables", () => {
    expect(Merge.setDotenv("# mine\nA=1\nREN_INFERENCE_KEY=old\n", { REN_INFERENCE_KEY: "new", B: "2" })).toBe(
      "# mine\nA=1\nREN_INFERENCE_KEY=new\nB=2\n",
    )
  })

  test("handles an empty file", () => {
    expect(Merge.setDotenv("", { A: "1" })).toBe("A=1\n")
  })
})
