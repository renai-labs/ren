import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { InfraFolder } from "../src/infra/folder.js"

const folder = async (files: Record<string, string | Uint8Array>) => {
  const root = await mkdtemp(join(tmpdir(), "ren-infra-"))
  await Promise.all(Object.entries(files).map(([path, content]) => Bun.write(join(root, path), content)))
  return root
}

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: Writes release notes.\nmetadata:\n  requiredCredentials:\n    - kind: env\n      name: TOKEN\n---\n${body}`

describe("InfraFolder.validate", () => {
  test("reads each file of an org spec into its place in the spec", async () => {
    const root = await folder({
      "org.yaml": "settings:\n  permissions:\n    - { action: bash, resource: '*', effect: ask }\n",
      "instructions.md": "Be brief.\n",
      "deploy.yaml": "organization: acme\n",
      "spaces/engineering/space.yaml": "name: Engineering\nuses:\n  agents: [triage]\n",
      "spaces/engineering/instructions.md": "Ship it.\n",
      "spaces/engineering/agents/build/agent.yaml": "description: Writes the code.\n",
      "spaces/engineering/agents/build/instructions.md": "Write tests first.\n",
      "spaces/engineering/apps/notes/app.yaml": "name: Notes\ndescription: Writes notes.\n",
      "spaces/engineering/apps/notes/skills/write/SKILL.md": skill("write", "# Write\n"),
      "spaces/engineering/apps/notes/skills/write/references/style.md": "Short lines.\n",
      "spaces/engineering/apps/notes/skills/fetch/skill.yaml":
        "upstream:\n  url: https://github.com/acme/skills\n  ref: main\n  path: fetch\n",
      "spaces/engineering/schedules.yaml":
        "nightly:\n  agent: build\n  cron: '0 3 * * *'\n  timeZone: UTC\n  message: Build it.\n",
      "spaces/support/space.yaml": "name: Support\n",
      "spaces/support/agents/triage/agent.yaml": "description: Sorts tickets.\nisSubagent: false\n",
    })

    const result = await InfraFolder.validate(root)

    expect(result.problems).toEqual([])
    if (result.kind !== "org") throw new Error("Expected an org spec")
    expect(result.bindings?.organization).toBe("acme")
    expect(result.spec.org.settings).toEqual({
      instructions: "Be brief.",
      permissions: [{ action: "bash", resource: "*", effect: "ask" }],
      references: [],
    })
    const engineering = result.spec.spaces["engineering"]
    expect(engineering?.settings.instructions).toBe("Ship it.")
    expect(engineering?.uses.agents).toEqual(["triage"])
    expect(engineering?.agents["build"]?.settings.instructions).toBe("Write tests first.")
    expect(engineering?.apps["notes"]?.skills).toEqual({
      write: {
        type: "content",
        description: "Writes release notes.",
        requiredCredentials: [{ kind: "env", name: "TOKEN", optional: false }],
        instructions: "# Write\n",
        files: { "references/style.md": "Short lines.\n" },
      },
      fetch: {
        type: "upstream",
        requiredCredentials: [],
        upstream: { url: "https://github.com/acme/skills", ref: "main", path: "fetch" },
      },
    })
    expect(Object.keys(engineering?.schedules ?? {})).toEqual(["nightly"])
    expect(Object.keys(result.spec.spaces)).toEqual(["engineering", "support"])
  })

  test("reports each problem at the file and field that hold it", async () => {
    const root = await folder({
      "org.yaml": "settings: {}\n",
      "spaces/engineering/space.yaml": "description: No name.\n",
      "spaces/engineering/agents/build/agent.yaml": "isSubagent: maybe\n",
      "spaces/engineering/agents/ren/agent.yaml": "{}\n",
      "spaces/engineering/schedules.yaml":
        "nightly:\n  agent: review\n  cron: '0 3 * * *'\n  timeZone: UTC\n  message: Review it.\n",
      "spaces/support/space.yaml": "name: Support\nuses:\n  agents: [qa]\n",
      "spaces/support/instructions.md": "Help.\n",
      "spaces/support/agents/qa/agent.yaml": "settings:\n  instructions: Test.\n",
      "spaces/support/agents/qa/instructions.md": "Test it.\n",
    })

    const result = await InfraFolder.validate(root)

    expect(result.problems.map(InfraFolder.format)).toEqual([
      "spaces/engineering/agents/build/agent.yaml: isSubagent: Expected boolean",
      "spaces/engineering/space.yaml: name: Missing key",
      "spaces/support/agents/qa: Put the instructions in instructions.md only.",
    ])
  })

  test("checks the rules across spaces once each file is valid", async () => {
    const root = await folder({
      "org.yaml": "settings: {}\n",
      "spaces/engineering/space.yaml": "name: Engineering\n",
      "spaces/engineering/agents/ren/agent.yaml": "{}\n",
      "spaces/engineering/schedules.yaml":
        "nightly:\n  agent: review\n  cron: '0 3 * * *'\n  timeZone: UTC\n  message: Review it.\n",
    })

    const result = await InfraFolder.validate(root)

    expect(result.problems.map(InfraFolder.format)).toEqual([
      "spaces/engineering/agents/ren/agent.yaml: The name ren is reserved.",
      'spaces/engineering/schedules.yaml: nightly.agent: Schedule "nightly" in space "engineering" runs on agent "review", which is not in the space.',
    ])
  })

  test("refuses a skill that is not text, or not named for its folder", async () => {
    const root = await folder({
      "org.yaml": "settings: {}\n",
      "spaces/engineering/space.yaml": "name: Engineering\n",
      "spaces/engineering/apps/notes/app.yaml": "name: Notes\ndescription: Writes notes.\n",
      "spaces/engineering/apps/notes/skills/write/SKILL.md": skill("draft", "# Write\n"),
      "spaces/engineering/apps/notes/skills/write/logo.png": new Uint8Array([137, 80, 78, 71, 0, 1]),
      "spaces/engineering/apps/notes/skills/empty/notes.md": "Nothing.\n",
    })

    const result = await InfraFolder.validate(root)

    expect(result.problems.map(InfraFolder.format)).toEqual([
      "spaces/engineering/apps/notes/skills/empty: A skill folder needs SKILL.md or skill.yaml.",
      "spaces/engineering/apps/notes/skills/write/logo.png: A skill holds text files only.",
      "spaces/engineering/apps/notes/skills/write/SKILL.md: name: The name “draft” must be the folder name, write.",
    ])
  })

  test("names the folder that has no spec, or does not exist", async () => {
    const root = await folder({ "README.md": "Hello.\n" })

    const result = await InfraFolder.validate(root)
    const missing = await InfraFolder.validate(join(root, "missing"))

    expect(missing.problems).toEqual(result.problems)

    expect(result.problems.map(InfraFolder.format)).toEqual([
      ".: No spec here. An org spec has org.yaml, and a private spec has space.yaml.",
    ])
  })
})

describe("InfraFolder.write", () => {
  const pulled = {
    bindings: { organization: "acme" },
    spec: {
      org: { settings: { instructions: "Be brief.", permissions: [], references: [] } },
      spaces: {
        engineering: {
          name: "Engineering",
          description: "Builds.",
          settings: {
            instructions: "  Ship it.\n\n    indented()\n\nKeep lines short.  \n",
            permissions: [{ action: "bash", resource: "*", effect: "ask" as const }],
            references: [],
          },
          agents: {
            build: {
              description: "Writes code.",
              isSubagent: false,
              settings: { instructions: "Test first.", permissions: [], references: [] },
            },
          },
          factory: { maxHandoffs: 5, agents: [{ agent: "ren", to: [{ agent: "build", max: 2 }] }, { agent: "build" }] },
          uses: { agents: [] },
        },
        home: { name: "Home", settings: { permissions: [], references: [] }, agents: {}, uses: { agents: ["build"] } },
      },
    },
  }

  test("writes a folder that reads back as the same spec", async () => {
    const root = join(await folder({}), ".ren")

    await InfraFolder.write(root, pulled)
    const result = await InfraFolder.validate(root)

    expect(result.problems).toEqual([])
    if (result.kind !== "org") throw new Error("Expected an org spec")
    expect(result.bindings?.organization).toBe("acme")
    expect(result.spec.org.settings).toEqual(pulled.spec.org.settings)
    expect(result.spec.spaces["engineering"]).toMatchObject(pulled.spec.spaces.engineering)
    expect(result.spec.spaces["home"]).toMatchObject(pulled.spec.spaces.home)
    expect(await Bun.file(join(root, "spaces/engineering/agents/build/agent.yaml")).text()).toBe(
      "description: Writes code.\n",
    )
    expect(await Bun.file(join(root, "spaces/home/space.yaml")).text()).toBe(
      "name: Home\nuses:\n  agents:\n    - build\n",
    )
  })

  test("removes the spaces, agents and instructions that are gone, and keeps every other file", async () => {
    const root = await folder({
      "spaces/old/space.yaml": "name: Old\n",
      "spaces/engineering/agents/lint/agent.yaml": "{}\n",
      "spaces/engineering/schedules.yaml": "{}\n",
      "spaces/home/instructions.md": "Stale.\n",
      "README.md": "Ours.\n",
    })

    await InfraFolder.write(root, pulled)

    const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root }))).toSorted()
    expect(files).toEqual([
      "README.md",
      "deploy.yaml",
      "instructions.md",
      "org.yaml",
      "spaces/engineering/agents/build/agent.yaml",
      "spaces/engineering/agents/build/instructions.md",
      "spaces/engineering/instructions.md",
      "spaces/engineering/schedules.yaml",
      "spaces/engineering/space.yaml",
      "spaces/home/space.yaml",
    ])
  })
})
