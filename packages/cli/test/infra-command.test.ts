import { describe, expect, test } from "bun:test"
import { InfraCommand } from "../src/infra/command.js"

const create = { action: "create" as const, kind: "space" as const, path: "spaces/support", fields: [] }
const update = {
  action: "update" as const,
  kind: "space" as const,
  path: "spaces/engineering",
  from: "spaces/eng",
  fields: ["slug", "settings"],
}
const archive = {
  action: "archive" as const,
  kind: "agent" as const,
  path: "spaces/engineering/agents/lint",
  fields: [],
}

const plan = (changes: ReadonlyArray<typeof create | typeof update | typeof archive>) => ({
  changes: [...changes],
  problems: [],
  digest: "abc",
})

describe("InfraCommand.render", () => {
  test("lists archives first and marks them", () => {
    expect(InfraCommand.render(plan([update, create, archive]))).toEqual([
      "- archive agent spaces/engineering/agents/lint",
      "~ update space spaces/engineering (from spaces/eng): slug, settings",
      "+ create space spaces/support",
    ])
  })
})

describe("InfraCommand.gate", () => {
  test("a plan with no changes has nothing to apply", () => {
    expect(InfraCommand.gate(plan([]), { interactive: true, allowArchive: false })).toEqual({
      kind: "done",
      message: "Nothing to apply.",
    })
  })

  test("a terminal confirms every plan", () => {
    expect(InfraCommand.gate(plan([archive]), { interactive: true, allowArchive: false })).toEqual({ kind: "confirm" })
  })

  test("without a terminal, apply takes only the digest of an earlier plan, and archives need --allow-archive", () => {
    expect(InfraCommand.gate(plan([create]), { interactive: false, allowArchive: false })).toEqual({
      kind: "refuse",
      message: "Without a terminal, apply needs --plan <digest> from ren2 infra plan.",
    })
    expect(InfraCommand.gate(plan([create]), { interactive: false, digest: "old", allowArchive: false })).toEqual({
      kind: "refuse",
      message: "The plan has changed since digest old. Run ren2 infra plan again.",
    })
    expect(InfraCommand.gate(plan([archive]), { interactive: false, digest: "abc", allowArchive: false })).toEqual({
      kind: "refuse",
      message: "The plan archives 1 row. Pass --allow-archive to apply it.",
    })
    expect(InfraCommand.gate(plan([archive]), { interactive: false, digest: "abc", allowArchive: true })).toEqual({
      kind: "apply",
    })
  })
})
