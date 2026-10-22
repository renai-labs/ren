import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Infra } from "../src/infra.js"

const agent = { description: "Writes the code." }

const app = (fields: Record<string, unknown> = {}) => ({
  name: "Release notes",
  description: "Writes notes.",
  ...fields,
})

const decode = (spaces: Record<string, unknown>, moved: ReadonlyArray<unknown> = []) =>
  Schema.decodeUnknownExit(Infra.Spec)({ org: { settings: {} }, spaces, moved })

describe("Infra.Spec", () => {
  test("a space uses an agent and an app that another space owns", () => {
    const exit = decode({
      engineering: {
        name: "Engineering",
        agents: { build: agent },
        apps: { "release-notes": app({ dependsOn: ["linear"] }) },
        uses: { apps: ["linear"] },
      },
      support: { name: "Support", uses: { agents: ["build"], apps: ["release-notes", "linear"] } },
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

  test("rejects a use of an app that the space owns", () => {
    const exit = decode({
      engineering: { name: "Engineering", apps: { "release-notes": app() }, uses: { apps: ["release-notes"] } },
    })
    expect(String(exit)).toContain('Space "engineering" owns app "release-notes", so it does not list it in uses.')
  })

  test("rejects a space that uses an app but not its dependency", () => {
    const exit = decode({
      engineering: { name: "Engineering", apps: { "release-notes": app({ dependsOn: ["linear"] }) } },
    })
    expect(String(exit)).toContain('Space "engineering" uses app "release-notes", which depends on "linear".')
  })

  test("rejects a skill that two apps define", () => {
    const skill = { type: "upstream", upstream: { url: "https://github.com/acme/skills.git" } }
    const exit = decode({
      engineering: { name: "Engineering", apps: { "release-notes": app({ skills: { changelog: skill } }) } },
      support: { name: "Support", apps: { "support-notes": app({ skills: { changelog: skill } }) } },
    })
    expect(String(exit)).toContain(
      'Skill "changelog" is defined in apps release-notes and support-notes. Move it into an app that both depend on.',
    )
  })

  test("rejects a cron on an agent that is not in its space", () => {
    const exit = decode({
      engineering: { name: "Engineering", agents: { build: agent } },
      support: { name: "Support", crons: { digest: { agent: "build", schedule: "0 9 * * *", message: "Post." } } },
    })
    expect(String(exit)).toContain('Cron "digest" in space "support" runs on agent "build", which is not in the space.')
  })

  test("rejects a move whose source still exists or whose target does not", () => {
    const exit = decode({ engineering: { name: "Engineering", agents: { build: agent } } }, [
      { from: "spaces/engineering/agents/build", to: "spaces/engineering/agents/qa" },
    ])
    expect(String(exit)).toContain('A move from "spaces/engineering/agents/build" names a resource that still exists.')
    expect(String(exit)).toContain('A move to "spaces/engineering/agents/qa" names a resource that does not exist.')
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
})
