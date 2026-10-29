import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { InfraFolder } from "../src/infra/folder.js"
import { Output } from "../src/services/output.js"

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

    expect(result.problems.map(Output.formatProblem)).toEqual([
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

    expect(result.problems.map(Output.formatProblem)).toEqual([
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

    expect(result.problems.map(Output.formatProblem)).toEqual([
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

    expect(result.problems.map(Output.formatProblem)).toEqual([
      ".: No spec here. An org spec has org.yaml, and a private spec has space.yaml.",
    ])
  })
})

describe("InfraFolder.write", () => {
  const pulled = {
    bindings: {
      organization: "acme",
      spaces: {
        engineering: {
          channels: { ren: { kind: "github" as const, repository: "acme/ren" } },
          profiles: { github: ["acme"] },
        },
      },
    },
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
          apps: {
            tools: {
              name: "Tools",
              description: "The team’s tools.",
              requiredCredentials: [],
              environment: { packages: { apt: ["gh"] }, buildCommands: [] },
              skills: {
                review: {
                  type: "content" as const,
                  description: "Reviews code.",
                  requiredCredentials: [],
                  instructions: "# Review\n\nRead the diff.\n",
                  files: { "references/rules.md": "No comments.\n" },
                },
                style: {
                  type: "upstream" as const,
                  requiredCredentials: [],
                  upstream: { url: "https://github.com/acme/skills", ref: "main", path: "style" },
                },
              },
              mcps: {},
              dependsOn: [],
            },
          },
          schedules: {
            nightly: { agent: "build", cron: "0 3 * * *", timeZone: "UTC", message: "Run the nightly.", enabled: true },
          },
          channels: { ren: { kind: "github" as const, purpose: "GitHub acme/ren", agent: "build", fallback: false } },
          uses: { agents: [] },
        },
        home: {
          name: "Home",
          settings: { permissions: [], references: [] },
          agents: {},
          apps: {},
          schedules: {},
          channels: {},
          uses: { agents: ["build"] },
        },
      },
    },
    lock: { organization: "acme", resources: {} },
    write: [
      "deploy.yaml/spaces/engineering/profiles/github/acme",
      "org",
      "spaces/engineering",
      "spaces/engineering/agents/build",
      "spaces/engineering/apps/tools",
      "spaces/engineering/channels/ren",
      "spaces/engineering/schedules/nightly",
      "spaces/home",
      "spaces/home/uses/agents/build",
    ],
    remove: [],
    conflicts: [],
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
    expect(result.bindings?.spaces["engineering"]).toMatchObject(pulled.bindings.spaces.engineering)
  })

  test("keeps the other frontmatter of a SKILL.md and the other bindings of a space", async () => {
    const root = await folder({
      "spaces/engineering/apps/tools/skills/review/SKILL.md":
        "---\nname: review\ndescription: Old.\nlicense: MIT\nmetadata:\n  icon: https://acme.test/icon.svg\n---\nOld.\n",
      "spaces/engineering/apps/tools/skills/review/stale.md": "Gone.\n",
      "spaces/engineering/apps/tools/skills/gone/SKILL.md": "---\nname: gone\ndescription: Gone.\n---\n",
      "deploy.yaml": "organization: old\nspaces:\n  engineering:\n    timezone: Asia/Kolkata\n    channels: {}\n",
    })

    await InfraFolder.write(root, pulled)

    expect(await Bun.file(join(root, "spaces/engineering/apps/tools/skills/review/SKILL.md")).text()).toBe(
      "---\nname: review\ndescription: Reviews code.\nlicense: MIT\nmetadata:\n  icon: https://acme.test/icon.svg\n---\n# Review\n\nRead the diff.\n",
    )
    expect(await Bun.file(join(root, "spaces/engineering/apps/tools/skills/review/stale.md")).exists()).toBe(false)
    expect(await Bun.file(join(root, "spaces/engineering/apps/tools/skills/gone/SKILL.md")).exists()).toBe(false)
    expect(Bun.YAML.parse(await Bun.file(join(root, "deploy.yaml")).text())).toEqual({
      organization: "acme",
      spaces: { engineering: { timezone: "Asia/Kolkata", ...pulled.bindings.spaces.engineering } },
    })
    const result = await InfraFolder.validate(root)
    expect(result.problems).toEqual([])
  })

  test("removes the spaces, agents and instructions that pull removes, and keeps every other file", async () => {
    const root = await folder({
      "spaces/old/space.yaml": "name: Old\n",
      "spaces/engineering/agents/lint/agent.yaml": "{}\n",
      "spaces/engineering/schedules.yaml": "{}\n",
      "spaces/home/instructions.md": "Stale.\n",
      "README.md": "Ours.\n",
    })

    await InfraFolder.write(root, { ...pulled, remove: ["spaces/engineering/agents/lint", "spaces/old"] })

    const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root }))).toSorted()
    expect(files).toEqual([
      "README.md",
      "deploy.yaml",
      "instructions.md",
      "org.yaml",
      "spaces/engineering/agents/build/agent.yaml",
      "spaces/engineering/agents/build/instructions.md",
      "spaces/engineering/apps/tools/app.yaml",
      "spaces/engineering/apps/tools/skills/review/SKILL.md",
      "spaces/engineering/apps/tools/skills/review/references/rules.md",
      "spaces/engineering/apps/tools/skills/style/skill.yaml",
      "spaces/engineering/channels.yaml",
      "spaces/engineering/instructions.md",
      "spaces/engineering/schedules.yaml",
      "spaces/engineering/space.yaml",
      "spaces/home/space.yaml",
    ])
  })
  test("writes only the resources that pull returns, and keeps the edits and keys of the others", async () => {
    const root = await folder({
      "spaces/engineering/space.yaml": "name: Mine\nrenamedFrom: [eng]\n",
      "spaces/engineering/agents/build/agent.yaml": "description: Mine.\n",
      "spaces/engineering/schedules.yaml":
        "local:\n  cron: '0 1 * * *'\n  timeZone: UTC\n  message: Ours.\nnightly:\n  cron: '0 2 * * *'\n  timeZone: UTC\n  message: Old.\n",
      "spaces/home/space.yaml": "name: Home\nuses:\n  agents: [review]\n",
      "deploy.yaml": "organization: acme\nspaces:\n  engineering:\n    timezone: UTC\n",
    })

    await InfraFolder.write(root, {
      ...pulled,
      write: ["spaces/engineering/schedules/nightly", "spaces/home/uses/agents/build"],
      remove: ["spaces/home/uses/agents/review"],
    })

    const text = (file: string) => Bun.file(join(root, file)).text()
    expect(await text("spaces/engineering/space.yaml")).toBe("name: Mine\nrenamedFrom: [eng]\n")
    expect(await text("spaces/engineering/agents/build/agent.yaml")).toBe("description: Mine.\n")
    expect(Bun.YAML.parse(await text("spaces/engineering/schedules.yaml"))).toEqual({
      local: { cron: "0 1 * * *", timeZone: "UTC", message: "Ours." },
      nightly: pulled.spec.spaces.engineering.schedules.nightly,
    })
    expect(Bun.YAML.parse(await text("spaces/home/space.yaml"))).toEqual({ name: "Home", uses: { agents: ["build"] } })
    expect(await text("deploy.yaml")).toBe("organization: acme\nspaces:\n  engineering:\n    timezone: UTC\n")
    expect(await Bun.file(join(root, "org.yaml")).exists()).toBe(false)
  })
})
