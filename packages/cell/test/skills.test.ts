import { expect, setDefaultTimeout } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { EnvironmentAccess } from "@ren/brain/environment/access"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { TestAccess, TestGitHub } from "@ren/brain/testing"
import { TestEnvironment, testEffect } from "@ren/executor/testing"
import { App } from "@ren/schema/app"
import type { AppCatalog } from "@ren/schema/app-catalog"
import { AppRelease } from "@ren/schema/app-release"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import type { Skill } from "@ren/schema/skill"
import { Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Env } from "../src/env.js"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { RenWorkspaceDriver } from "../src/harness/opencode/workspace-driver.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"

setDefaultTimeout(30_000)

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const local = await realpath(await mkdtemp(join(tmpdir(), "ren-local-")))
const stub = Shared.stub()
const it = testEffect(TestEnvironment.layer({ environmentId, workspace }))
const folder = (sessionId: Session.ID) => join(workspace, sessionId)

const catalog = (skills: Readonly<Record<string, Skill.Declaration>>): AppCatalog.Info => {
  const releaseId = AppRelease.ID.create()
  return {
    fingerprint: crypto.randomUUID(),
    catalog: {
      apps: [],
      mcps: [],
      credentials: [],
      skills: Object.entries(skills).map((entry) => ({
        appId: App.ID.create(),
        releaseId,
        appSlug: "docs",
        version: "1.0.0",
        slug: entry[0],
        declaration: entry[1],
      })),
    },
  }
}

const content = (instructions: string, files: Readonly<Record<string, string>> = {}): Skill.Declaration => ({
  type: "content",
  description: "Use it to test skills",
  requiredCredentials: [],
  instructions,
  files,
})

const upstream = (url: string, ref?: string): Skill.Declaration => ({
  type: "upstream",
  requiredCredentials: [],
  upstream: { url, path: "skills/pdf", ...(ref && { ref }) },
})

const document = (body: string) => `---\nname: PDF\ndescription: Fill PDF forms\n---\n${body}\n`

const open = Effect.fnUntraced(function* (github?: TestGitHub.Instance) {
  const context = yield* Layer.build(TestAccess.memory(new Map()))
  const memory = Context.get(context, TestAccess.Memory)
  const opens = yield* Ref.make(0)
  const counted = Layer.succeed(
    EnvironmentAccess.Service,
    EnvironmentAccess.Service.of({
      release: () => Effect.void,
      open: (sessionId) =>
        Ref.update(opens, (count) => count + 1).pipe(
          Effect.andThen(Context.get(context, EnvironmentAccess.Service).open(sessionId)),
        ),
    }),
  )
  const environments = Context.get(
    yield* Layer.build(EnvironmentConnections.layer.pipe(Layer.provide(counted), Layer.provide(FetchHttpClient.layer))),
    EnvironmentConnections.Service,
  )
  const vars = Schema.decodeUnknownSync(Env.Vars)(Shared.vars(stub.url))
  const endpoints = Shared.access(undefined, stub.url).endpoints
  const host = yield* OpenCodeServer.make(
    (replacements) =>
      createEmbeddedRoutes(
        {
          database: { path: ":memory:" },
          config: { project: false, content: vars.OPENCODE_CONFIG },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
        },
        [...replacements, ...RenWorkspaceDriver.replacements(environments)],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    () => Effect.succeedNone,
    Option.some(environments),
    {
      saved: Option.none(),
      directoryOf: () => local,
      ...(github && { skills: { hosts: github.hosts, refresh: 0 } }),
    },
  )
  const harness = yield* OpenCodeHarness.make(host, endpoints)
  const begin = Effect.fnUntraced(function* (options: { readonly onEnvironment?: boolean } = {}) {
    const sessionId = Session.ID.create()
    const onEnvironment = options.onEnvironment ?? true
    if (onEnvironment)
      yield* memory.set(
        sessionId,
        yield* TestEnvironment.access({
          url: yield* TestEnvironment.url,
          environmentId,
          brain: Brain.ofSession(sessionId),
          directory: folder(sessionId),
        }),
      )
    yield* harness.start({
      sessionId,
      harness: "opencode",
      interactive: false,
      ...(onEnvironment && { directory: folder(sessionId) }),
    })
    const turn = (script: StubModel.Script, calls = 2) =>
      harness
        .send({
          sessionId,
          messageId: Session.MessageID.create(),
          prompt: { text: `${script.marker} go` },
          delivery: "steer",
          sender: { userId: "user_1" },
        })
        .pipe(
          Effect.andThen(Effect.promise(() => script.called(calls))),
          Effect.tap(() => host.client.session.wait({ sessionID: SessionID.make(sessionId) }).pipe(Effect.orDie)),
        )
    return {
      sessionId,
      turn,
      load: (id: string) => turn(stub.script({ tool: { name: "skill", input: { id } } })),
      shell: (command: string) => turn(stub.script({ tool: { name: "shell", input: { command } } })),
      mention: (id: string) => {
        const script = stub.script()
        return harness.chat
          .prompt(sessionId, {
            id: SessionMessage.ID.create(),
            text: `${script.marker} use it`,
            delivery: "steer",
            sender: Option.none(),
            skills: [{ id }],
          })
          .pipe(
            Effect.andThen(Effect.promise(() => script.called(1))),
            Effect.tap(() => host.client.session.wait({ sessionID: SessionID.make(sessionId) }).pipe(Effect.orDie)),
          )
      },
    }
  })
  return { harness, begin, opens: Ref.get(opens) }
})

const result = (call: StubModel.Call) =>
  JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content ?? "")

const sent = (call: StubModel.Call) => JSON.stringify(call.body.messages)

const count = (text: string, part: string) => text.split(part).length - 1

it.live("an installed text skill is listed and loads once by tool and by mention, without the environment", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* opened.begin()
    const body = `notes-${crypto.randomUUID()}`
    yield* opened.harness.configure({ apps: Option.some(catalog({ notes: content(body) })) })
    expect(yield* opened.harness.chat.skills(session.sessionId)).toContainEqual(
      expect.objectContaining({ id: "notes", description: "Use it to test skills" }),
    )
    const loaded = yield* session.load("notes")
    expect([count(result(loaded), body), count(sent(loaded), body)]).toEqual([1, 1])
    const mentioned = yield* session.mention("notes")
    expect(count(sent(mentioned), body)).toBe(2)
    expect(yield* opened.opens).toBe(0)
  }),
)

it.live("a mentioned skill's files reach the environment at the first environment call after it loads", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* opened.begin()
    const marker = crypto.randomUUID()
    yield* opened.harness.configure({
      apps: Option.some(catalog({ forms: content("Run scripts/fill.sh", { "scripts/fill.sh": `echo ${marker}\n` }) })),
    })
    const mentioned = sent(yield* session.mention("forms"))
    const base = /Base directory for this skill: ([^\\]+)\\n/u.exec(mentioned)?.[1] ?? ""
    expect([base.startsWith(join(folder(session.sessionId), ".ren", "skills", "forms")), yield* opened.opens]).toEqual([
      true,
      0,
    ])
    expect(result(yield* session.shell(`sh ${base}/scripts/fill.sh`))).toContain(marker)
    expect(yield* opened.opens).toBe(1)
  }),
)

it.live(
  "a GitHub skill follows its branch with matching files, a pinned one stays, and a session hears of the change",
  () =>
    Effect.gen(function* () {
      const github = yield* TestGitHub.make()
      const first = yield* github.commit({
        "skills/pdf/SKILL.md": document("Run scripts/fill.sh, first."),
        "skills/pdf/scripts/fill.sh": "echo first\n",
      })
      const opened = yield* open(github)
      const session = yield* opened.begin()
      yield* opened.harness.configure({
        apps: Option.some(catalog({ pdf: upstream(github.url), pinned: upstream(github.url, first) })),
      })
      expect(yield* opened.harness.chat.skills(session.sessionId)).toContainEqual(
        expect.objectContaining({ id: "pdf", name: "PDF", description: "Fill PDF forms" }),
      )
      const loaded = result(yield* session.load("pdf"))
      const base = /Base directory for this skill: ([^\\]+)\\n/u.exec(loaded)?.[1] ?? ""
      expect([loaded.includes("Run scripts/fill.sh, first."), base.endsWith(first.slice(0, 12))]).toEqual([true, true])
      expect(result(yield* session.shell(`sh ${base}/scripts/fill.sh`))).toContain("first")
      const second = yield* github.commit({
        "skills/pdf/SKILL.md": document("Run scripts/fill.sh, second."),
        "skills/pdf/scripts/fill.sh": "echo second\n",
      })
      const beforeRefresh = (yield* github.requests).length
      const told = yield* session.turn(stub.script(), 1)
      expect(
        (yield* github.requests).slice(beforeRefresh).filter((request) => request.includes("info/refs")),
      ).toHaveLength(1)
      expect(told.system).toContain("The skill pdf changed after this chat loaded it")
      const reloaded = result(yield* session.load("pdf"))
      const next = /Base directory for this skill: ([^\\]+)\\n/u.exec(reloaded)?.[1] ?? ""
      expect([reloaded.includes("second."), next.endsWith(second.slice(0, 12))]).toEqual([true, true])
      expect(result(yield* session.shell(`sh ${next}/scripts/fill.sh; sh ${base}/scripts/fill.sh`))).toContain(
        "second\\nfirst",
      )
      expect(result(yield* session.load("pinned"))).toContain("Run scripts/fill.sh, first.")
    }),
)

it.live("parallel environment calls wait for a loaded skill's files", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make()
    yield* github.commit({ "skills/pdf/SKILL.md": document("Read reference.md"), "skills/pdf/reference.md": "copied" })
    const opened = yield* open(github)
    const session = yield* opened.begin()
    yield* opened.harness.configure({ apps: Option.some(catalog({ pdf: upstream(github.url) })) })
    const base = /Base directory for this skill: ([^\\]+)\\n/u.exec(result(yield* session.load("pdf")))?.[1] ?? ""
    const script = stub.script({
      parallelTools: [
        { name: "shell", input: { command: `cat ${base}/reference.md` } },
        { name: "shell", input: { command: `cat ${base}/reference.md` } },
      ],
    })
    const call = yield* session.turn(script)
    const results = call.body.messages.filter((message) => message.role === "tool").slice(-2)
    expect(results).toHaveLength(2)
    for (const message of results) expect(JSON.stringify(message.content)).toContain("copied")
    expect((yield* github.requests).filter((request) => request.startsWith("/archive/"))).toHaveLength(1)
  }),
)

it.live("a failed skill copy stays pending for the next environment call", () =>
  Effect.gen(function* () {
    const github = yield* TestGitHub.make()
    yield* github.commit({
      "skills/pdf/SKILL.md": document("Read reference.md"),
      "skills/pdf/reference.md": "recovered",
    })
    const opened = yield* open(github)
    const session = yield* opened.begin()
    yield* opened.harness.configure({ apps: Option.some(catalog({ pdf: upstream(github.url) })) })
    const base = /Base directory for this skill: ([^\\]+)\\n/u.exec(result(yield* session.load("pdf")))?.[1] ?? ""
    yield* github.fail(true)
    expect(result(yield* session.shell(`cat ${base}/reference.md`))).toContain("The archive answered 503")
    yield* github.fail(false)
    expect(result(yield* session.shell(`cat ${base}/reference.md`))).toContain("recovered")
  }),
)

it.live("a chat without an environment loads a text skill and is told that a skill's files are not available", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* opened.begin({ onEnvironment: false })
    yield* opened.harness.configure({
      apps: Option.some(catalog({ notes: content("notes"), forms: content("forms", { "fill.sh": "echo\n" }) })),
    })
    expect(result(yield* session.load("notes"))).not.toContain("no execution environment")
    expect(result(yield* session.load("forms"))).toContain("This chat has no execution environment")
    expect(yield* opened.opens).toBe(0)
  }),
)

it.live("an app's removal takes its skills away in the same session", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* opened.begin()
    yield* opened.harness.configure({ apps: Option.some(catalog({ notes: content("notes") })) })
    yield* session.load("notes")
    yield* opened.harness.configure({ apps: Option.some(catalog({})) })
    expect(result(yield* session.load("notes"))).toContain("Unable to load skill notes")
    expect(yield* opened.harness.chat.skills(session.sessionId)).not.toContainEqual(
      expect.objectContaining({ id: "notes" }),
    )
  }),
)
