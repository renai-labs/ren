import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Infra } from "../src/infra.js"
import { App } from "../src/app.js"

const agent = { description: "Writes the code." }

const app = (fields: Record<string, unknown> = {}) => ({
  name: "Release notes",
  description: "Writes notes.",
  ...fields,
})

const decode = (spaces: Record<string, unknown>) =>
  Schema.decodeUnknownExit(Infra.Spec)({ org: { settings: {} }, spaces })

describe("Infra.Spec", () => {
  test("rejects a Linear channel and a Linear binding: the spec maps GitHub and Slack, not Linear", () => {
    expect(
      Exit.isFailure(decode({ home: { name: "Home", channels: { tickets: { kind: "linear", purpose: "T" } } } })),
    ).toBe(true)
    expect(
      Exit.isFailure(
        Schema.decodeUnknownExit(Infra.Bindings)({
          organization: "acme",
          spaces: { home: { channels: { tickets: { kind: "linear", projectId: "P1" } } } },
        }),
      ),
    ).toBe(true)
  })

  test("a space uses an agent that another space owns", () => {
    const exit = decode({
      engineering: { name: "Engineering", agents: { build: agent } },
      support: { name: "Support", uses: { agents: ["build"] } },
    })
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("rejects an agent that two spaces define", () => {
    const exit = decode({
      engineering: { name: "Engineering", agents: { build: agent } },
      support: { name: "Support", agents: { build: agent } },
    })
    expect(String(exit)).toContain('Agent "build" is defined in engineering and support.')
  })

  test("rejects an agent with a reserved name", () => {
    const exit = decode({ engineering: { name: "Engineering", agents: { ren: agent } } })
    expect(String(exit)).toContain("The name ren is reserved.")
  })

  test("rejects a use of an agent that no space defines", () => {
    const exit = decode({ support: { name: "Support", uses: { agents: ["build"] } } })
    expect(String(exit)).toContain('Space "support" uses agent "build", which no space defines.')
  })

  test("rejects a use of an agent that the space owns", () => {
    const exit = decode({ engineering: { name: "Engineering", agents: { build: agent }, uses: { agents: ["build"] } } })
    expect(String(exit)).toContain('Space "engineering" owns agent "build", so it does not list it in uses.')
  })

  test("rejects an app that two spaces define", () => {
    const exit = decode({
      engineering: { name: "Engineering", apps: { "release-notes": app() } },
      support: { name: "Support", apps: { "release-notes": app() } },
    })
    expect(String(exit)).toContain('App "release-notes" is defined in engineering and support.')
  })

  test("rejects a skill that two apps define", () => {
    const skill = { type: "upstream", upstream: { url: "https://github.com/acme/skills.git", path: "." } }
    const exit = decode({
      engineering: { name: "Engineering", apps: { "release-notes": app({ skills: { changelog: skill } }) } },
      support: { name: "Support", apps: { "support-notes": app({ skills: { changelog: skill } }) } },
    })
    expect(String(exit)).toContain(
      'Skill "changelog" is defined in apps release-notes and support-notes. Move it into an app that both depend on.',
    )
  })

  test("rejects a schedule on an agent that is not in its space", () => {
    const exit = decode({
      engineering: { name: "Engineering", agents: { build: agent } },
      support: {
        name: "Support",
        schedules: { digest: { agent: "build", cron: "0 9 * * *", timeZone: "Europe/Berlin", message: "Post." } },
      },
    })
    expect(String(exit)).toContain(
      'Schedule "digest" in space "support" runs on agent "build", which is not in the space.',
    )
  })

  test("a factory names the agents of its space, ren included, and keeps the factory rules", () => {
    const factory = (agents: ReadonlyArray<unknown>) =>
      decode({
        engineering: { name: "Engineering", agents: { build: agent, review: agent } },
        support: { name: "Support", agents: { triage: agent }, factory: { agents } },
      })
    expect(Exit.isSuccess(factory([{ agent: "ren", to: [{ agent: "triage" }] }, { agent: "triage" }]))).toBe(true)
    expect(String(factory([{ agent: "build" }]))).toContain(
      'The factory of space "support" names agent "build", which is not in the space.',
    )
    expect(String(factory([{ agent: "triage", to: [{ agent: "triage" }] }]))).toContain(
      "triage cannot hand off to itself.",
    )
  })

  test("rejects a renamedFrom name that the spec still defines", () => {
    const exit = decode({
      engineering: {
        name: "Engineering",
        renamedFrom: ["support"],
        agents: { build: { ...agent, renamedFrom: ["qa"] }, qa: agent },
        apps: { notes: app({ renamedFrom: ["changelog"] }), changelog: app() },
      },
      support: { name: "Support" },
    })
    expect(String(exit)).toContain('Space "engineering" is renamed from "support", which the spec still defines.')
    expect(String(exit)).toContain('Agent "build" is renamed from "qa", which the spec still defines.')
    expect(String(exit)).toContain('App "notes" is renamed from "changelog", which the spec still defines.')
  })

  const mcp = (fields: Record<string, unknown>) =>
    decode({
      engineering: {
        name: "Engineering",
        apps: {
          langfuse: app({
            mcps: {
              langfuse: {
                name: "Langfuse",
                description: "Read traces.",
                transport: { type: "remote", url: "https://cloud.langfuse.com/api/public/mcp" },
                ...fields,
              },
            },
          }),
        },
      },
    })

  test("an MCP authenticates with credentials it requires, by env name", () => {
    const exit = mcp({
      auth: { type: "basic", username: "LANGFUSE_PUBLIC_KEY", password: "LANGFUSE_SECRET_KEY" },
      requiredCredentials: [
        { kind: "env", name: "LANGFUSE_PUBLIC_KEY" },
        { kind: "env", name: "LANGFUSE_SECRET_KEY" },
      ],
    })
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("rejects MCP auth that names a credential the MCP does not require", () => {
    const exit = mcp({
      auth: { type: "basic", username: "LANGFUSE_PUBLIC_KEY", password: "LANGFUSE_SECRET_KEY" },
      requiredCredentials: [{ kind: "env", name: "LANGFUSE_PUBLIC_KEY" }],
    })
    expect(String(exit)).toContain('The auth uses credential "LANGFUSE_SECRET_KEY", which the MCP does not require.')
  })

  test("custom dependency cycles report their path", () => {
    const exit = decode({
      engineering: {
        name: "Engineering",
        apps: {
          first: app({ dependsOn: ["second"] }),
          second: app({ dependsOn: ["first"] }),
        },
      },
    })
    expect(String(exit)).toContain("first -> second -> first")
    expect(
      App.dependencyCycles(
        new Map([
          ["first", { dependsOn: ["second"] }],
          ["second", { dependsOn: ["first"] }],
        ]),
      ),
    ).toEqual(["first -> second -> first"])
  })

  test("an upstream skill requires one safe explicit source directory", () => {
    for (const path of [
      undefined,
      "",
      "..",
      "../tools",
      "/tools",
      "tools//notes",
      "tools/../notes",
      "tools\\notes",
      "tools/./notes",
    ]) {
      const exit = decode({
        engineering: {
          name: "Engineering",
          apps: {
            notes: app({
              skills: { notes: { type: "upstream", upstream: { url: "https://github.com/acme/skills", path } } },
            }),
          },
        },
      })
      expect(Exit.isFailure(exit)).toBe(true)
    }
  })

  test("a memory folder has memory.md, and each file has a relative path that a folder can hold", () => {
    const memory = (files: Record<string, string>) => decode({ engineering: { name: "Engineering", memory: files } })
    expect(Exit.isSuccess(memory({}))).toBe(true)
    expect(Exit.isSuccess(memory({ "memory.md": "", "people/ana.md": "Ana leads design." }))).toBe(true)
    expect(String(memory({ "people/ana.md": "Ana leads design." }))).toContain("A memory folder needs memory.md.")
    for (const path of ["/people.md", "../people.md", "people//ana.md", "people/../ana.md", "people/.ana.md"])
      expect(Exit.isFailure(memory({ "memory.md": "", [path]: "Ana." }))).toBe(true)
  })
})

describe("Infra.SpaceBindings", () => {
  test("binds the shared profiles that list a space by app and profile slug; credentials is gone (P36)", () => {
    const decoded = Schema.decodeUnknownSync(Infra.SpaceBindings)({
      profiles: { "meta-ads": ["acme", "globex"] },
      credentials: { "meta-ads": { META_TOKEN: "META_TOKEN" } },
    })
    expect(decoded.profiles).toEqual({ "meta-ads": ["acme", "globex"] })
    expect("credentials" in decoded).toBe(false)
  })
})
