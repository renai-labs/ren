import { describe, expect, test } from "bun:test"
import { Infra } from "@ren/schema/infra"
import { Schema } from "effect"
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
      "environments.yaml": "Python:\n  provider: docker\n  config:\n    image: python:3.13\n",
      "spaces/engineering/space.yaml":
        "name: Engineering\nbrainScope: session\nhand:\n  placement: remote\n  environment: Python\nuses:\n  agents: [triage]\n",
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
      "spaces/engineering/memory/memory.md": "- Ship on Fridays.\n",
      "spaces/engineering/memory/people/ana.md": "Ana leads design.\n",
      "spaces/support/space.yaml": "name: Support\n",
      "spaces/support/agents/triage/agent.yaml": "description: Sorts tickets.\nisSubagent: false\n",
      "memory/memory.md": "- Be brief.\n",
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
    expect(Schema.encodeSync(Infra.Spec)(result.spec).environments).toEqual({
      Python: {
        provider: "docker",
        config: { image: "python:3.13" },
        sessionsPerEnvironment: 8,
        networking: { type: "unrestricted" },
      },
    })
    const engineering = result.spec.spaces["engineering"]
    expect(engineering).toMatchObject({ brainScope: "session", hand: { placement: "remote", environment: "Python" } })
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
    expect(engineering?.memory).toEqual({ "memory.md": "- Ship on Fridays.\n", "people/ana.md": "Ana leads design.\n" })
    expect(result.spec.memory).toEqual({ "memory.md": "- Be brief.\n" })
    expect(Object.keys(result.spec.spaces)).toEqual(["engineering", "support"])
  })

  test("reports each problem at the file and field that hold it", async () => {
    const root = await folder({
      "org.yaml": "settings: {}\n",
      "deploy.yaml":
        "organization: acme\nprofiles:\n  github:\n    acme: { name: ' Acme' }\nspaces:\n  support:\n    timezone: Asia/Kolkata\n",
      "environments.yaml": "Python:\n  provider: docker\n  config: {}\n  sessionsPerEnvironment: 0\n",
      "spaces/engineering/space.yaml": "description: No name.\n",
      "spaces/engineering/agents/build/agent.yaml": "isSubagent: maybe\n",
      "spaces/engineering/agents/ren/agent.yaml": "{}\n",
      "spaces/engineering/schedules.yaml":
        "nightly:\n  agent: review\n  cron: '0 3 * * *'\n  timeZone: UTC\n  message: Review it.\n",
      "spaces/support/space.yaml": "name: Support\nuses:\n  agents: [qa]\n",
      "spaces/support/instructions.md": "Help.\n",
      "spaces/support/agents/qa/agent.yaml": "settings:\n  instructions: Test.\n",
      "spaces/support/agents/qa/instructions.md": "Test it.\n",
      "spaces/support/memory/people/ana.md": "Ana leads design.\n",
      "spaces/support/apps/notes/app.yaml": "name: Notes\ndescription: Writes notes.\nrenamedFrom: [changelog]\n",
      "memory/memory.md": "- Be brief.\n",
      "memory/logo.png": new Uint8Array([137, 80, 78, 71, 0, 1]),
    })

    const result = await InfraFolder.validate(root)

    expect(result.problems.map(Output.formatProblem)).toEqual([
      "deploy.yaml: profiles.github.acme.name: Remove spaces at the start and end.",
      "deploy.yaml: spaces.support.timezone: A space has no time zone. Each schedule has its own.",
      "environments.yaml: Python.sessionsPerEnvironment: Use 1 to 100 sessions per environment.",
      "memory/logo.png: A memory holds text files only.",
      "spaces/engineering/agents/build/agent.yaml: isSubagent: Use true or false.",
      "spaces/engineering/space.yaml: name: Missing key",
      "spaces/support/agents/qa: Put the instructions in instructions.md only.",
      "spaces/support/apps/notes/app.yaml: renamedFrom: Ren cannot rename an app.",
      "spaces/support/memory: A memory folder needs memory.md.",
    ])
  })

  test("reports each unknown key once, at the file and field that hold it", async () => {
    const root = await folder({
      "org.yaml": "settings:\n  permisions: []\n",
      "environments.yaml": "Python:\n  provider: docker\n  config:\n    image: python:3.13\n    any: { nested: key }\n",
      "deploy.yaml": "organization: acme\nspaces:\n  engineering:\n    chanels: {}\n  support:\n    timezone: UTC\n",
      "spaces/engineering/space.yaml": "name: Engineering\nhand:\n  placement: none\n  enviroment: Python\n",
      "spaces/engineering/agents/build/agent.yaml": "descripton: Writes the code.\n",
      "spaces/engineering/apps/notes/app.yaml": "name: Notes\ndescription: Writes notes.\nrenamedFrom: [old]\n",
      "spaces/engineering/apps/notes/mcps.yaml":
        "docs:\n  name: Docs\n  description: Reads docs.\n  transport: { type: remote, url: 'https://acme.test/mcp', headers: {} }\n  auth: { type: none }\n",
      "spaces/engineering/apps/notes/skills/write/SKILL.md":
        "---\nname: write\ndescription: Writes.\nlicense: MIT\nallowed-tools: Read\nmetadata:\n  icon: https://acme.test/icon.svg\n---\nWrite.\n",
      "spaces/engineering/schedules.yaml":
        "nightly:\n  cron: '0 3 * * *'\n  timeZone: UTC\n  message: Build it.\n  enabeld: false\n",
      "spaces/engineering/webhooks.yaml":
        "pull-requests:\n  message: Review it.\n  treadKey: body.id\nreleases:\n  app: notes\n  preset: release\n  mesage: Hi.\n",
      "spaces/engineering/channels.yaml": "ren:\n  kind: github\n  purpose: GitHub acme/ren\n  agnet: build\n",
    })

    const result = await InfraFolder.validate(root)

    expect(result.problems.map(Output.formatProblem)).toEqual([
      "deploy.yaml: spaces.engineering.chanels: Unknown key. Use channels or profiles.",
      "deploy.yaml: spaces.support.timezone: A space has no time zone. Each schedule has its own.",
      "org.yaml: settings.permisions: Unknown key. Use instructions, model, defaultModels, steps, permissions or references.",
      "spaces/engineering/agents/build/agent.yaml: descripton: Unknown key. Use description, isSubagent, settings or renamedFrom.",
      "spaces/engineering/apps/notes/app.yaml: renamedFrom: Ren cannot rename an app.",
      "spaces/engineering/apps/notes/mcps.yaml: docs.transport.headers: Unknown key. Use type or url.",
      "spaces/engineering/channels.yaml: ren.agnet: Unknown key. Use kind, purpose, agent, fallback or triggers.",
      "spaces/engineering/schedules.yaml: nightly.enabeld: Unknown key. Use name, agent, cron, timeZone, message, until or enabled.",
      "spaces/engineering/space.yaml: hand.enviroment: Unknown key. Use placement.",
      "spaces/engineering/webhooks.yaml: pull-requests.treadKey: Unknown key. Use name, agent, message, signature, handshake, signedHandshake, filter, eventId, threadKey, title or mode.",
      "spaces/engineering/webhooks.yaml: releases.mesage: Unknown key. Use app, preset, agent or mode.",
    ])
  })

  test("says what a name must be when a folder or key has one that is not allowed", async () => {
    const root = await folder({
      "org.yaml": "settings: {}\n",
      "deploy.yaml":
        "organization: acme\nprofiles:\n  tools:\n    platform-deploy-bot-for-acme-example: { name: Bot }\nspaces:\n  engineering:\n    channels:\n      Bad_Channel: { kind: github, repository: acme/ren }\n    profiles:\n      Bad_App: [acme]\n",
      "environments.yaml": "' Python':\n  provider: docker\n  config: {}\n",
      "spaces/Eng_1/space.yaml": "name: Eng\n",
      "spaces/engineering/space.yaml": "name: Engineering\n",
      "spaces/engineering/agents/Bad_Name/agent.yaml": "{}\n",
      "spaces/engineering/apps/Bad_App/app.yaml": "name: Bad\ndescription: Bad.\n",
      "spaces/engineering/apps/notes/app.yaml":
        "name: Notes\ndescription: Writes notes.\nwebhooks:\n  Bad_Preset: {}\n",
      "spaces/engineering/apps/notes/mcps.yaml": "Bad_Mcp: {}\n",
      "spaces/engineering/apps/notes/skills/Bad_Skill/SKILL.md": skill("Bad_Skill", "# Write\n"),
      "spaces/engineering/schedules.yaml": "Bad_Schedule: {}\n",
      "spaces/engineering/webhooks.yaml": "Bad_Webhook: {}\n",
      "spaces/engineering/channels.yaml": "Bad_Channel: {}\n",
      "spaces/engineering/memory/memory.md": "- Ship it.\n",
      "spaces/engineering/memory/${filename}.md": "Ana.\n",
    })

    const result = await InfraFolder.validate(root)

    const slug = "Use lowercase letters and digits, joined by single dashes."
    expect(result.problems.map(Output.formatProblem)).toEqual([
      `deploy.yaml: profiles.tools.platform-deploy-bot-for-acme-example: “platform-deploy-bot-for-acme-example” is not a valid name. Use 32 characters or fewer.`,
      `deploy.yaml: spaces.engineering.channels.Bad_Channel: “Bad_Channel” is not a valid name. ${slug}`,
      `deploy.yaml: spaces.engineering.profiles.Bad_App: “Bad_App” is not a valid name. ${slug}`,
      "environments.yaml:  Python: “ Python” is not a valid name. Remove spaces at the start and end.",
      `spaces/Eng_1: “Eng_1” is not a valid name. ${slug}`,
      `spaces/engineering/agents/Bad_Name: “Bad_Name” is not a valid name. ${slug}`,
      `spaces/engineering/apps/Bad_App: “Bad_App” is not a valid name. ${slug}`,
      `spaces/engineering/apps/notes/app.yaml: webhooks.Bad_Preset: “Bad_Preset” is not a valid name. ${slug}`,
      `spaces/engineering/apps/notes/mcps.yaml: Bad_Mcp: “Bad_Mcp” is not a valid name. ${slug}`,
      `spaces/engineering/apps/notes/skills/Bad_Skill: “Bad_Skill” is not a valid name. ${slug}`,
      `spaces/engineering/channels.yaml: Bad_Channel: “Bad_Channel” is not a valid name. ${slug}`,
      "spaces/engineering/memory/${filename}.md: A path has no ${filename}.",
      `spaces/engineering/schedules.yaml: Bad_Schedule: “Bad_Schedule” is not a valid name. ${slug}`,
      `spaces/engineering/webhooks.yaml: Bad_Webhook: “Bad_Webhook” is not a valid name. ${slug}`,
    ])
  })

  test("names the values a field takes, not the schema behind it", async () => {
    const root = await folder({
      "org.yaml":
        "settings:\n  model: gpt\n  steps: many\n  permissions:\n    - { action: bash, resource: '*', effect: allow }\n",
      "spaces/engineering/space.yaml": "name: Engineering\nbrainScope: org\nhand:\n  placement: far\n",
      "spaces/engineering/apps/notes/app.yaml":
        "name: Notes\ndescription: Writes notes.\nicon: http://acme.test/notes.svg\n",
      "spaces/engineering/schedules.yaml":
        "nightly:\n  cron: 5\n  timeZone: UTC\n  message: Build it.\n  enabled: 'yes'\n",
      "spaces/engineering/webhooks.yaml":
        "pull-requests:\n  message: Review it.\n  signature: { kind: rsa }\n  mode: on-call\n",
      "spaces/engineering/channels.yaml": "ren:\n  kind: gitlab\n  purpose: GitLab acme/ren\n",
    })

    const result = await InfraFolder.validate(root)

    expect(result.problems.map(Output.formatProblem)).toEqual([
      "org.yaml: settings.model: Use a map with endpointId and modelId.",
      "org.yaml: settings.permissions.0.effect: Use ask or deny.",
      "org.yaml: settings.steps: Use a number.",
      "spaces/engineering/apps/notes/app.yaml: icon: Use an https URL.",
      "spaces/engineering/channels.yaml: ren: Use a map whose kind is slack or github.",
      "spaces/engineering/schedules.yaml: nightly.cron: Use text.",
      "spaces/engineering/schedules.yaml: nightly.enabled: Use true or false.",
      "spaces/engineering/space.yaml: brainScope: Use session or space.",
      "spaces/engineering/space.yaml: hand: Use a map whose placement is colocated, remote or none.",
      "spaces/engineering/webhooks.yaml: pull-requests.mode: Use listening or live.",
      "spaces/engineering/webhooks.yaml: pull-requests.signature: Use a map whose kind is none, header, hmac, standard or stripe.",
    ])
  })

  test("checks the rules across spaces once each file is valid", async () => {
    const root = await folder({
      "org.yaml": "settings: {}\n",
      "spaces/engineering/space.yaml":
        "name: Engineering\nbrain:\n  environment: Python\nfactory:\n  maxHandoffs: 3\n  agents:\n    - agent: helper\n",
      "spaces/engineering/agents/ren/agent.yaml": "{}\n",
      "spaces/engineering/agents/helper/agent.yaml": "isSubagent: true\n",
      "spaces/engineering/schedules.yaml":
        "nightly:\n  agent: review\n  cron: '0 3 * * *'\n  timeZone: UTC\n  message: Review it.\n",
    })

    const result = await InfraFolder.validate(root)

    expect(result.problems.map(Output.formatProblem)).toEqual([
      "spaces/engineering/agents/helper/agent.yaml: description: A subagent needs a description, so other agents know when to use it.",
      "spaces/engineering/agents/ren/agent.yaml: The name ren is reserved.",
      'spaces/engineering/schedules.yaml: nightly.agent: Schedule "nightly" in space "engineering" runs on agent "review", which is not in the space.',
      'spaces/engineering/space.yaml: brain.environment: The brain of space "engineering" names environment template "Python", which the spec does not declare.',
      'spaces/engineering/space.yaml: factory.agents.0.agent: Agent "helper" is a subagent, so it cannot be in the factory. Pick another agent.',
    ])
  })

  test("checks deploy.yaml against the spec once both are valid", async () => {
    const root = await folder({
      "org.yaml": "settings: {}\n",
      "deploy.yaml": "organization: acme\nspaces:\n  ops: {}\n",
      "spaces/engineering/space.yaml": "name: Engineering\n",
    })

    const result = await InfraFolder.validate(root)

    expect(result.problems.map(Output.formatProblem)).toEqual([
      'deploy.yaml: spaces.ops: The spec declares no space "ops".',
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
      profiles: { github: { acme: { name: "Acme" }, everyone: { name: "Everyone", allSpaces: true } } },
      spaces: {
        engineering: {
          channels: { ren: { kind: "github" as const, repository: "acme/ren" } },
          profiles: { github: ["acme"] },
        },
      },
    },
    spec: {
      org: { settings: { instructions: "Be brief.", permissions: [], references: [] } },
      memory: { "memory.md": "" },
      environments: {
        Python: {
          provider: "docker",
          config: { image: "python:3.13" },
          sessionsPerEnvironment: 2,
          networking: { type: "unrestricted" as const },
        },
      },
      spaces: {
        engineering: {
          name: "Engineering",
          description: "Builds.",
          brainScope: "session" as const,
          brain: { environment: "Python" },
          hand: { placement: "remote" as const, environment: "Python" },
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
              icon: "https://acme.test/tools.svg",
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
              mcps: {
                docs: {
                  name: "Docs",
                  description: "Reads docs.",
                  transport: { type: "local" as const, command: ["docs-mcp"] as const, env: { MODE: "read" } },
                  auth: {
                    type: "oauth" as const,
                    tokenEndpointAuth: "none" as const,
                    client: { clientId: "ren", redirectUri: "https://acme.test/callback" },
                  },
                  timeouts: { startup: 1000 },
                  requiredCredentials: [],
                },
              },
              webhooks: {
                release: {
                  name: "Release",
                  description: "A new release.",
                  message: "Write the notes.",
                  signature: { kind: "header" as const, header: "x-release-token" },
                  filter: 'body.action == "published"',
                  secret: "ren" as const,
                  setup: "Paste the URL in the release settings.",
                },
              },
              dependsOn: [],
            },
          },
          schedules: {
            nightly: {
              name: "Nightly",
              agent: "build",
              cron: "0 3 * * *",
              timeZone: "UTC",
              message: "Run the nightly.",
              until: "2027-01-01T00:00:00.000Z",
              enabled: false,
            },
          },
          webhooks: {
            "pull-requests": {
              message: "Review this pull request.",
              signature: {
                kind: "hmac" as const,
                header: "x-hub-signature-256",
                encoding: "hex" as const,
                prefix: "sha256=",
              },
              filter: 'headers["x-github-event"] == "pull_request"',
              threadKey: "body.pull_request.html_url",
              mode: "live" as const,
            },
            releases: { app: "tools", preset: "release", agent: "build", mode: "listening" as const },
          },
          channels: {
            ren: {
              kind: "github" as const,
              purpose: "GitHub acme/ren",
              agent: "build",
              fallback: false,
              triggers: { pull_request_ready: { prompt: "Review it." } },
            },
          },
          memory: { "memory.md": "- Ship on Fridays.\n", "people/ana.md": "  Ana leads design.  \n\n" },
          uses: { agents: [] },
        },
        home: {
          name: "Home",
          settings: { permissions: [], references: [] },
          agents: {},
          apps: {},
          schedules: {},
          webhooks: {},
          channels: {},
          uses: { agents: ["build"] },
        },
      },
    },
    lock: { organization: "acme", resources: {} },
    write: [
      "deploy.yaml/profiles/github/acme",
      "deploy.yaml/profiles/github/everyone",
      "deploy.yaml/spaces/engineering/profiles/github/acme",
      "environments/Python",
      "memory/memory.md",
      "org",
      "spaces/engineering",
      "spaces/engineering/agents/build",
      "spaces/engineering/apps/tools",
      "spaces/engineering/channels/ren",
      "spaces/engineering/memory/memory.md",
      "spaces/engineering/memory/people/ana.md",
      "spaces/engineering/schedules/nightly",
      "spaces/engineering/webhooks/pull-requests",
      "spaces/engineering/webhooks/releases",
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
    expect(result.spec.memory).toEqual(pulled.spec.memory)
    expect(Schema.encodeSync(Infra.Spec)(result.spec).environments).toEqual(pulled.spec.environments)
    expect(Schema.encodeSync(Infra.Spec)(result.spec).spaces["engineering"]).toMatchObject(
      pulled.spec.spaces.engineering,
    )
    expect(result.spec.spaces["home"]).toMatchObject(pulled.spec.spaces.home)
    expect(await Bun.file(join(root, "spaces/engineering/agents/build/agent.yaml")).text()).toBe(
      "description: Writes code.\n",
    )
    expect(await Bun.file(join(root, "spaces/home/space.yaml")).text()).toBe(
      "name: Home\nuses:\n  agents:\n    - build\n",
    )
    expect(result.bindings?.spaces["engineering"]).toMatchObject(pulled.bindings.spaces.engineering)
    expect(result.bindings?.profiles).toEqual(pulled.bindings.profiles)
  })

  test("keeps the other frontmatter of a SKILL.md", async () => {
    const root = await folder({
      "spaces/engineering/apps/tools/skills/review/SKILL.md":
        "---\nname: review\ndescription: Old.\nlicense: MIT\nmetadata:\n  icon: https://acme.test/icon.svg\n---\nOld.\n",
      "spaces/engineering/apps/tools/skills/review/stale.md": "Gone.\n",
      "spaces/engineering/apps/tools/skills/gone/SKILL.md": "---\nname: gone\ndescription: Gone.\n---\n",
      "deploy.yaml": "organization: old\nspaces:\n  engineering:\n    channels: {}\n",
    })

    await InfraFolder.write(root, pulled)

    expect(await Bun.file(join(root, "spaces/engineering/apps/tools/skills/review/SKILL.md")).text()).toBe(
      "---\nname: review\ndescription: Reviews code.\nlicense: MIT\nmetadata:\n  icon: https://acme.test/icon.svg\n---\n# Review\n\nRead the diff.\n",
    )
    expect(await Bun.file(join(root, "spaces/engineering/apps/tools/skills/review/stale.md")).exists()).toBe(false)
    expect(await Bun.file(join(root, "spaces/engineering/apps/tools/skills/gone/SKILL.md")).exists()).toBe(false)
    expect(Bun.YAML.parse(await Bun.file(join(root, "deploy.yaml")).text())).toEqual({
      organization: "acme",
      profiles: pulled.bindings.profiles,
      spaces: { engineering: pulled.bindings.spaces.engineering },
    })
    const result = await InfraFolder.validate(root)
    expect(result.problems).toEqual([])
  })

  test("removes the spaces, agents, memory files and instructions that pull removes, and keeps every other file", async () => {
    const root = await folder({
      "environments.yaml": "Old:\n  provider: docker\n  config: {}\n",
      "spaces/old/space.yaml": "name: Old\n",
      "spaces/engineering/agents/lint/agent.yaml": "{}\n",
      "spaces/engineering/schedules.yaml": "{}\n",
      "spaces/engineering/memory/stale.md": "Deleted in Ren.\n",
      "spaces/engineering/memory/drafts/mine.md": "Not applied yet.\n",
      "spaces/home/instructions.md": "Stale.\n",
      "README.md": "Ours.\n",
    })

    await InfraFolder.write(root, {
      ...pulled,
      remove: [
        "environments/Old",
        "spaces/engineering/agents/lint",
        "spaces/engineering/memory/stale.md",
        "spaces/old",
      ],
    })

    const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root }))).toSorted()
    expect(Object.keys(Bun.YAML.parse(await Bun.file(join(root, "environments.yaml")).text()) ?? {})).toEqual([
      "Python",
    ])
    expect(files).toEqual([
      "README.md",
      "deploy.yaml",
      "environments.yaml",
      "instructions.md",
      "memory/memory.md",
      "org.yaml",
      "spaces/engineering/agents/build/agent.yaml",
      "spaces/engineering/agents/build/instructions.md",
      "spaces/engineering/apps/tools/app.yaml",
      "spaces/engineering/apps/tools/mcps.yaml",
      "spaces/engineering/apps/tools/skills/review/SKILL.md",
      "spaces/engineering/apps/tools/skills/review/references/rules.md",
      "spaces/engineering/apps/tools/skills/style/skill.yaml",
      "spaces/engineering/channels.yaml",
      "spaces/engineering/instructions.md",
      "spaces/engineering/memory/drafts/mine.md",
      "spaces/engineering/memory/memory.md",
      "spaces/engineering/memory/people/ana.md",
      "spaces/engineering/schedules.yaml",
      "spaces/engineering/space.yaml",
      "spaces/engineering/webhooks.yaml",
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
      "deploy.yaml":
        "organization: acme\nprofiles:\n  github:\n    mine: { name: Mine }\n    gone: { name: Gone }\nspaces:\n  engineering:\n    channels:\n      ren:\n        kind: github\n        repository: acme/mine\n",
    })

    await InfraFolder.write(root, {
      ...pulled,
      write: [
        "deploy.yaml/profiles/github/acme",
        "spaces/engineering/schedules/nightly",
        "spaces/home/uses/agents/build",
      ],
      remove: ["deploy.yaml/profiles/github/gone", "spaces/home/uses/agents/review"],
    })

    const text = (file: string) => Bun.file(join(root, file)).text()
    expect(await text("spaces/engineering/space.yaml")).toBe("name: Mine\nrenamedFrom: [eng]\n")
    expect(await text("spaces/engineering/agents/build/agent.yaml")).toBe("description: Mine.\n")
    expect(Bun.YAML.parse(await text("spaces/engineering/schedules.yaml"))).toEqual({
      local: { cron: "0 1 * * *", timeZone: "UTC", message: "Ours." },
      nightly: pulled.spec.spaces.engineering.schedules.nightly,
    })
    expect(Bun.YAML.parse(await text("spaces/home/space.yaml"))).toEqual({ name: "Home", uses: { agents: ["build"] } })
    expect(Bun.YAML.parse(await text("deploy.yaml"))).toEqual({
      organization: "acme",
      profiles: { github: { mine: { name: "Mine" }, acme: { name: "Acme" } } },
      spaces: { engineering: { channels: { ren: { kind: "github", repository: "acme/mine" } } } },
    })
    expect(await Bun.file(join(root, "org.yaml")).exists()).toBe(false)
  })
})
