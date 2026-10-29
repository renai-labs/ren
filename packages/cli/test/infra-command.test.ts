import { describe, expect, test } from "bun:test"
import type { Infra } from "@ren/schema/infra"
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

const conflict = {
  action: "update" as const,
  status: "conflict" as const,
  kind: "agent" as const,
  path: "spaces/engineering/agents/build",
  fields: ["settings"],
  values: [
    {
      field: "settings.instructions",
      ren: "Plan first.\nTest first.\nShip.",
      folder: "Plan first.\nTest last.\nShip.",
    },
  ],
}
const changed = {
  action: "update" as const,
  status: "changed" as const,
  kind: "agent" as const,
  path: "spaces/engineering/agents/review",
  fields: ["description"],
  values: [{ field: "description", ren: "Reviews.", folder: "Reads." }],
}

const plan = (changes: ReadonlyArray<Infra.Change>) => ({
  changes: [...changes],
  problems: [],
  digest: "abc",
  lock: { organization: "acme", resources: {} },
})

describe("InfraCommand.render", () => {
  test("lists archives first and marks them", () => {
    expect(InfraCommand.render(plan([update, create, archive]))).toEqual([
      "- archive agent spaces/engineering/agents/lint",
      "~ update space spaces/engineering (from spaces/eng): slug, settings",
      "+ create space spaces/support",
    ])
  })

  test("shows each value that differs: a conflict as Ren to the folder, a change in Ren as the folder to Ren", () => {
    expect(InfraCommand.render(plan([conflict, changed]))).toEqual([
      "! conflict update agent spaces/engineering/agents/build: settings",
      "    settings.instructions:",
      "        Plan first.",
      "      - Test first.",
      "      + Test last.",
      "        Ship.",
      "< changed in Ren agent spaces/engineering/agents/review: description",
      "    description:",
      "      - Reads.",
      "      + Reviews.",
    ])
    expect(InfraCommand.render(plan([conflict]), { force: true }).at(0)).toBe(
      "! force update agent spaces/engineering/agents/build: settings",
    )
  })
})

describe("InfraCommand.render of long values", () => {
  test("diffs only the lines around a change, and lists both sides of a value too large to diff", () => {
    const text = (edited: string) =>
      Array.from({ length: 5000 }, (_, index) => (index === 2500 ? edited : `line ${index}`)).join("\n")
    const long = { ...update, values: [{ field: "x", ren: text("old"), folder: text("new") }] }
    expect(InfraCommand.render(plan([long])).slice(1)).toEqual([
      "    x:",
      "        …",
      "        line 2499",
      "      - old",
      "      + new",
      "        line 2501",
      "        …",
    ])
    const lines = (prefix: string) => Array.from({ length: 1000 }, (_, index) => `${prefix} ${index}`).join("\n")
    const unrelated = { ...update, values: [{ field: "x", ren: lines("a"), folder: lines("b") }] }
    expect(InfraCommand.render(plan([unrelated]))).toHaveLength(2002)
  })
})

describe("InfraCommand.gate", () => {
  test("a plan with no changes, or only changes in Ren, has nothing to apply", () => {
    expect(InfraCommand.gate(plan([changed]), { interactive: true, allowArchive: false, force: false })).toEqual({
      kind: "done",
      message: "Nothing to apply.",
    })
  })

  test("a conflict refuses apply without --force", () => {
    expect(
      InfraCommand.gate(plan([conflict, create]), { interactive: true, allowArchive: false, force: false }),
    ).toEqual({
      kind: "refuse",
      message:
        "1 resource changed in Ren and in the folder. Pull and merge them with git, or pass --force to apply the folder over them.",
    })
    expect(
      InfraCommand.gate(plan([conflict, create]), { interactive: true, allowArchive: false, force: true }),
    ).toEqual({
      kind: "confirm",
    })
  })

  test("--force applies a deleted resource that changed in Ren only with --allow-archive, and says it archives", () => {
    const deleted = { ...archive, status: "conflict" as const }
    expect(
      InfraCommand.gate(plan([deleted]), { interactive: false, digest: "abc", allowArchive: false, force: true }),
    ).toEqual({ kind: "refuse", message: "The plan archives 1 row. Pass --allow-archive to apply it." })
    expect(InfraCommand.render(plan([deleted]), { force: true })).toEqual([
      "! force archive agent spaces/engineering/agents/lint",
    ])
  })

  test("a terminal confirms every plan", () => {
    expect(InfraCommand.gate(plan([archive]), { interactive: true, allowArchive: false, force: false })).toEqual({
      kind: "confirm",
    })
  })

  test("without a terminal, apply takes only the digest of an earlier plan, and archives need --allow-archive", () => {
    expect(InfraCommand.gate(plan([create]), { interactive: false, allowArchive: false, force: false })).toEqual({
      kind: "refuse",
      message: "Without a terminal, apply needs --plan <digest> from ren2 infra plan.",
    })
    expect(
      InfraCommand.gate(plan([create]), { interactive: false, digest: "old", allowArchive: false, force: false }),
    ).toEqual({
      kind: "refuse",
      message: "The plan has changed since digest old. Run ren2 infra plan again.",
    })
    expect(
      InfraCommand.gate(plan([archive]), { interactive: false, digest: "abc", allowArchive: false, force: false }),
    ).toEqual({
      kind: "refuse",
      message: "The plan archives 1 row. Pass --allow-archive to apply it.",
    })
    expect(
      InfraCommand.gate(plan([archive]), { interactive: false, digest: "abc", allowArchive: true, force: false }),
    ).toEqual({
      kind: "apply",
    })
  })
})
