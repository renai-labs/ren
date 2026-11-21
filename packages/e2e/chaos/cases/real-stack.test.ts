import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { AppRegistry } from "@ren/core/app/registry"
import { Seed } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import type { App } from "@ren/schema/app"
import { AppProfile } from "@ren/schema/app-profile"
import { Brain } from "@ren/schema/brain"
import { SessionMessage } from "@ren/schema/session/message"
import { Space } from "@ren/schema/space"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { ExecutorAdapter } from "../lib/adapters/executor.js"
import { ExecutorDriver } from "../lib/drivers/executor.js"
import { SessionDriver } from "../lib/drivers/session.js"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { RealStack } from "../lib/real-stack.js"
import { Wait } from "../lib/wait.js"

const Creators = Schema.Array(Schema.Struct({ user: Schema.String }))

const pdfCommit = "dbd4588f9e1033efb41dad4bef2f7947c8993d44"

const batch = (marker: string) =>
  Schema.decodeUnknownSync(AppRegistry.Batch)({
    apps: [
      {
        slug: "e2e-skills",
        name: "Skills",
        description: "A text skill, a skill with files and a GitHub skill",
        listing: {},
        skills: {
          notes: {
            type: "content",
            description: "Use for notes",
            instructions: `Write notes the ${marker} way.`,
          },
          forms: {
            type: "content",
            description: "Use for forms",
            instructions: "Run scripts/fill.sh to fill a form.",
            files: { "scripts/fill.sh": `echo filled ${marker}\n` },
          },
          pdf: {
            type: "upstream",
            upstream: { url: "https://github.com/anthropics/skills", ref: pdfCommit, path: "skills/pdf" },
          },
        },
      },
    ],
  })

const baseOf = (output: string) => /Base directory for this skill: (\S+)/u.exec(output)?.[1] ?? ""

const savedTo = (result: string) =>
  /(?:full output saved to|Output is streaming to:) ([^\]\s]+)/.exec(result)?.[1] ?? ""

describe.skipIf(Platform.wrangler !== undefined || Platform.docker !== undefined)(
  "the real Ren server, a Wrangler cell and Docker sandboxes",
  () => {
    const lane: { stack?: RealStack.Instance } = {}
    const stack = () => {
      if (!lane.stack) throw new Error("the stack did not start")
      return lane.stack
    }
    const full = () => stack().sandbox("full")

    const pidOf = (session: RealStack.Driver, file: string) =>
      Wait.until(`the process ID in ${file}`, 60_000, async () => {
        const read = await full().container.observe(["cat", `${full().folder(session.sessionId)}/${file}`])
        return read.exitCode === 0 && read.stdout.trim() !== "" ? read.stdout.trim() : undefined
      })
    const stops = (pid: string, ms: number) =>
      Wait.until(`process ${pid} to stop in the container`, ms, async () =>
        (await full().container.observe(["kill", "-0", pid])).exitCode === 0 ? undefined : true,
      )

    // oxlint-disable-next-line ren/no-comments -- Lists a shared profile of the app in the owner's space. A session brain reaches its space's apps only through its creator's space membership (Credentials.scopeOf); a chat's creator is always a member.
    const install = (appId: App.ID) =>
      stack().run(
        Effect.gen(function* () {
          const owner = stack().owner
          const database = yield* Database.Service
          const profileId = AppProfile.ID.create()
          yield* database.db.insert(Database.Schema.app_profile).values({
            id: profileId,
            organization_id: owner.organizationId,
            app_id: appId,
            slug: "team",
            name: "Team",
            kind: "shared",
          })
          yield* database.db
            .insert(Database.Schema.app_profile_space)
            .values({ profile_id: profileId, space_id: owner.spaceId })
          yield* database.db
            .insert(Database.Schema.space_member)
            .values({ id: Space.MembershipID.create(), space_id: owner.spaceId, user_id: owner.createdBy })
            .onConflictDoNothing()
        }),
      )

    beforeAll(async () => {
      lane.stack = await RealStack.start({
        environments: [{ label: "full" }, { label: "second" }],
        tokenLifetime: "20 seconds",
      })
    }, 600_000)

    afterAll(() => lane.stack?.dispose(), 120_000)

    test("shell and file tools run in the session's folder in the container, with a token that the server issued", async () => {
      const before = stack().issued()
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo $((40 + 2)); pwd" })).toBe(
        `42\n/workspace/${session.sessionId}\n`,
      )
      expect(stack().issued() - before).toBe(1)
      await session.tool("write", { path: "notes.txt", content: "one\ntwo\n" })
      expect(await session.tool("read", { path: "notes.txt" })).toContain("2: two")
      expect(await session.tool("edit", { path: "notes.txt", oldString: "two", newString: "three" })).toContain(
        "Edited",
      )
      expect(await session.tool("glob", { pattern: "**/*.txt" })).toContain("notes.txt")
      expect(await session.tool("grep", { pattern: "three" })).toContain("notes.txt")
      expect((await full().container.observe(["cat", `${full().folder(session.sessionId)}/notes.txt`])).stdout).toBe(
        "one\nthree\n",
      )
    }, 600_000)

    test("the full output of a long command is in the container at the path OpenCode names", async () => {
      const session = await stack().session()
      const saved = savedTo(await session.tool("shell", { command: "seq 1 30000" }))
      expect(saved).toStartWith("/tmp/opencode/data/shell/")
      expect(await session.tool("shell", { command: `tail -n 1 ${saved}; grep -c . ${saved}` })).toBe("30000\n30000\n")
      expect(await session.tool("read", { path: saved, offset: 15000, limit: 1 })).toContain("15000")
    }, 600_000)

    test("the full output of a session's long command is only in its own container", async () => {
      const one = await stack().session()
      const two = await stack().session({ environment: stack().sandbox("second") })
      const savedOne = savedTo(await one.tool("shell", { command: "seq 1 30000" }))
      const savedTwo = savedTo(await two.tool("shell", { command: "seq 1 40000" }))
      const has = async (label: string, file: string) =>
        (await stack().sandbox(label).container.observe(["test", "-f", file])).exitCode === 0
      expect([
        await has("full", savedOne),
        await has("second", savedOne),
        await has("second", savedTwo),
        await has("full", savedTwo),
      ]).toEqual([true, false, true, false])
    }, 600_000)

    test("a session with no environment has no file or shell tools", async () => {
      const none = await stack().session({ environment: false })
      const onNone = stack().provider.script([ModelProvider.text("ok")])
      await none.send(`work ${onNone.marker}`)
      const tools = (await onNone.called(1, 60_000)).tools
      expect(tools.filter((name) => ["read", "edit", "write", "glob", "grep", "shell"].includes(name))).toEqual([])
    }, 600_000)

    test("two sessions on one container each see only their own folder", async () => {
      const one = await stack().session()
      const two = await stack().session()
      expect(await one.tool("shell", { command: "echo mine > mine.txt; ls" })).toBe("mine.txt\n")
      expect(await two.tool("shell", { command: "ls; pwd" })).toBe(`/workspace/${two.sessionId}\n`)
    }, 600_000)

    test("interrupting a turn stops its command in the container", async () => {
      const session = await stack().session()
      await session.turn([ModelProvider.tool("shell", { command: "echo $$ > run.pid; exec sleep 120" })])
      const pid = await pidOf(session, "run.pid")
      expect((await session.opencode.session.interrupt({ sessionID: session.sessionId })).interrupted).toBe(true)
      await stops(pid, 15_000)
    }, 600_000)

    test("a container restarted during a command ends the call with a disconnect notice, and the next call works", async () => {
      const session = await stack().session()
      const started = Date.now()
      const turn = await session.turn([
        ModelProvider.tool("shell", { command: "echo $$ > restart.pid; sleep 20; echo finished" }),
        ModelProvider.text("ok"),
      ])
      await pidOf(session, "restart.pid")
      await full().container.restart()
      full().retarget()
      const result = (await turn.called(2, 120_000)).toolResults
      expect([result.includes("environment disconnected"), result.includes("finished")]).toEqual([true, false])
      expect(Date.now() - started).toBeLessThan(60_000)
      await session.settled()
      expect(await session.tool("shell", { command: "echo back" })).toBe("back\n")
    }, 600_000)

    test("a network cut between the cell and the container during a command does not lose the command", async () => {
      const session = await stack().session()
      const turn = await session.turn([
        ModelProvider.tool("shell", { command: "echo $$ > cut.pid; sleep 4; echo $((40 + 2))" }),
        ModelProvider.text("ok"),
      ])
      await pidOf(session, "cut.pid")
      full().proxy().partition(true)
      full().proxy().cutAll()
      // ast-grep-ignore: no-test-sleep -- the network stays cut for a real time
      await Bun.sleep(5_000)
      full().proxy().partition(false)
      expect((await turn.called(2, 120_000)).toolResults).toBe("42\n")
      await session.settled()
      expect(await session.tool("shell", { command: "echo $((1 + 2))" })).toBe("3\n")
    }, 600_000)

    test("a call to a paused container fails in its time limit with a clear cause, and works after the thaw", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo ready" })).toBe("ready\n")
      await full().container.freeze()
      const started = Date.now()
      const frozen = await session.tool("shell", { command: "echo frozen" }, 180_000)
      await full().container.thaw()
      expect([frozen.includes("does not answer"), Date.now() - started < 120_000]).toEqual([true, true])
      expect(await session.tool("shell", { command: "echo thawed" })).toBe("thawed\n")
    }, 600_000)

    // oxlint-disable-next-line ren/no-comments -- A turn's end gives its environment seat back to Ren (cell/src/harness/opencode/plugin.ts), so the cached token serves the rest of the turn, not the next turn.
    test("a command works while the server is down for the rest of its turn", async () => {
      const session = await stack().session()
      const turn = await session.turn([
        ModelProvider.tool("shell", { command: "echo up" }),
        ModelProvider.tool("shell", { command: "echo cached" }, { hold: true }),
        ModelProvider.text("done"),
      ])
      await turn.called(2)
      await stack().stopServer()
      turn.release()
      const down = (await turn.called(3)).toolResults
      await session.idle(60_000)
      await stack().startServer()
      expect(down.endsWith("cached\n")).toBe(true)
    }, 600_000)

    test("a server restarted between a token and its refresh gives the refresh", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo before" })).toBe("before\n")
      await stack().restartServer()
      const before = stack().issued()
      // ast-grep-ignore: no-test-sleep -- the server's 20 second token must expire in real time
      await Bun.sleep(25_000)
      expect(await session.tool("shell", { command: "echo after" })).toBe("after\n")
      expect(stack().issued() - before).toBeGreaterThanOrEqual(1)
    }, 600_000)

    test("a cell that crashes during a command: the command stops within the orphan time, and a start without the environment keeps it", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo kept > kept.txt" })).toBe("(no output)")
      await session.turn([ModelProvider.tool("shell", { command: "echo $$ > crash.pid; exec sleep 120" })])
      const pid = await pidOf(session, "crash.pid")
      const crashedAt = Date.now()
      await stack().restartCell()
      await stops(pid, 45_000)
      expect(Date.now() - crashedAt).toBeLessThan(35_000)
      await session.start({ withoutEnvironment: true })
      expect(await session.tool("shell", { command: "cat kept.txt; pwd" })).toBe(
        `kept\n/workspace/${session.sessionId}\n`,
      )
    }, 600_000)

    test("a container replaced at a new URL: the first call finds the old one gone, and the next runs in the new, empty workspace", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo old > old.txt; ls" })).toBe("old.txt\n")
      const brain = Brain.ofSession(session.sessionId)
      const before = await ExecutorDriver.connect(
        full().container.url(),
        await ExecutorAdapter.token(full().container.environmentId, brain),
      )
      const old = await before.ok(before.client["process.spawn"]({ command: "sleep", arguments: ["120"] }))
      await before.dispose()
      await full().replaceAtNewUrl()
      const first = await session.tool("shell", { command: "echo first" })
      expect(first === "first\n" || first.includes("does not answer")).toBe(true)
      expect(await session.tool("shell", { command: "ls -a; echo listed" })).toBe(".\n..\nlisted\n")
      const after = await ExecutorDriver.connect(
        full().container.url(),
        await ExecutorAdapter.token(full().container.environmentId, brain),
      )
      expect((await after.output(old.id, 10_000)).error).toBe("ProcessNotFoundError")
      await after.dispose()
    }, 600_000)

    // oxlint-disable-next-line ren/no-comments -- D48 finds a replaced sandbox only when the old one stops answering; one at the same URL answers, so the folder is missing until the next refresh.
    test.todo("a container replaced at the same URL runs the next call in the new, empty workspace", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo old > old.txt; ls" })).toBe("old.txt\n")
      await full().replaceAtSameUrl()
      expect(await session.tool("shell", { command: "ls -a; echo listed" })).toBe(".\n..\nlisted\n")
    })

    test("a refused token request names the cause, and the brain does not ask again for 30 seconds", async () => {
      const session = await stack().session()
      const rule = stack().renProxy.inject(
        { operation: `POST /host/sessions/${session.sessionId}/environment/access` },
        { type: "status", status: 403 },
        1,
      )
      const refused = await session.tool("shell", { command: "echo refused" })
      expect([rule.applied(), refused.includes("Unable to execute"), refused.includes("refused\n")]).toEqual([
        true,
        true,
        false,
      ])
      const asked = stack().issued()
      expect(await session.tool("shell", { command: "echo soon" })).toContain("StatusCode error (403 POST")
      expect(stack().issued()).toBe(asked)
    }, 600_000)

    test("the agent calls Ren MCP as the sender of each turn", async () => {
      const real = stack()
      const member = await real.run(
        Effect.gen(function* () {
          const database = yield* Database.Service
          const joined = yield* Seed.actor(real.owner.organizationId, "member")
          yield* database.db
            .insert(Database.Schema.space_member)
            .values({ id: Space.MembershipID.create(), space_id: real.owner.spaceId, user_id: joined.userId })
          return joined.userId
        }),
      )
      const session = await real.session({ environment: false })
      const create = async (title: string, sender: typeof member) => {
        const code = `return await tools.ren.task_create(${JSON.stringify({ spaceId: real.owner.spaceId, title })})`
        const turn = await session.turn([ModelProvider.tool("execute", { code }), ModelProvider.text("ok")], "work", {
          sender,
        })
        const result = (await turn.called(2, 120_000)).toolResults
        await session.idle(60_000)
        return result
      }
      expect(await create(`by member ${crypto.randomUUID()}`, member)).toContain("by member")
      expect(await create(`by owner ${crypto.randomUUID()}`, real.owner.createdBy)).toContain("by owner")
      const creators = await real.run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return Schema.decodeUnknownSync(Creators)(
            yield* sql`select created_by_user_id as "user" from task where space_id = ${real.owner.spaceId} order by created_at`,
          )
        }),
      )
      expect(creators).toEqual([{ user: member }, { user: real.owner.createdBy }])
    }, 600_000)

    test.skipIf(Platform.github !== undefined)(
      "a text skill, a skill with files and a GitHub skill load by tool and mention, and files reach the sandbox only on use",
      async () => {
        const marker = crypto.randomUUID()
        const published = await stack().run(
          AppRegistry.Service.use((registry) => registry.publish(batch(marker))).pipe(
            Effect.provide(AppRegistry.layer),
          ),
        )
        const appId = published.apps.at(0)?.appId
        if (!appId) throw new Error("the app was not published")
        await install(appId)
        const session = await stack().session()
        const issued = stack().issued()

        const notes = await session.tool("skill", { id: "notes" })
        expect(notes).toContain(`Write notes the ${marker} way.`)
        const pdf = await session.tool("skill", { id: "pdf" })
        expect(pdf).toContain('<skill_content name="pdf">')
        expect(baseOf(pdf)).toEndWith(`/.ren/skills/pdf/${pdfCommit.slice(0, 12)}`)

        const mention = stack().provider.script([ModelProvider.text("ok")])
        await session.chat.session.prompt({
          sessionID: session.sessionId,
          id: SessionMessage.ID.create(),
          text: `use it ${mention.marker}`,
          delivery: "steer",
          skills: [{ id: "forms" }],
        })
        const mentioned = await mention.called(1)
        await session.idle(60_000)
        expect(mentioned.prompt).toContain("Run scripts/fill.sh to fill a form.")
        expect(stack().issued()).toBe(issued)

        const ran = await session.tool("shell", {
          command: `sh ${baseOf(mentioned.prompt)}/scripts/fill.sh; ls ${baseOf(pdf)}/scripts`,
        })
        expect(ran).toContain(`filled ${marker}`)
        expect(ran).toContain("fill_fillable_fields.py")
        expect(stack().issued()).toBeGreaterThan(issued)
        expect(
          (
            await stack()
              .sandbox("full")
              .container.observe(["cat", `${baseOf(pdf)}/SKILL.md`])
          ).stdout,
        ).toContain("name: pdf")
      },
      600_000,
    )

    test("a bundle's apps set up on the container before the first shell, each after the apps it depends on, once per container", async () => {
      const log = `/tmp/app-setup-${crypto.randomUUID()}.log`
      const published = await stack().run(
        AppRegistry.Service.use((registry) =>
          registry.publish(
            Schema.decodeUnknownSync(AppRegistry.Batch)({
              apps: [
                {
                  slug: "e2e-tools",
                  name: "Tools",
                  description: "Only a build command",
                  listing: {},
                  environment: { buildCommands: [`echo tools >> ${log}`] },
                },
                {
                  slug: "e2e-suite",
                  name: "Suite",
                  description: "A bundle that includes the tools",
                  listing: {},
                  dependsOn: ["e2e-tools"],
                  skills: { guide: { type: "content", description: "Use for the suite", instructions: "Guide." } },
                  environment: { buildCommands: [`echo suite >> ${log}`] },
                },
              ],
            }),
          ),
        ).pipe(Effect.provide(AppRegistry.layer)),
      )
      const suite = published.apps.find((app) => app.slug === "e2e-suite")?.appId
      if (!suite) throw new Error("the bundle was not published")
      await install(suite)
      const first = await stack().session()
      expect(await first.tool("shell", { command: `cat ${log}` })).toBe("tools\nsuite\n")
      const second = await stack().session()
      expect(await second.tool("shell", { command: `cat ${log}` })).toBe("tools\nsuite\n")
    }, 600_000)

    test("the alarm syncs a turn with a tool call to Postgres, and again after the cell dies during a pass, with no request to the cell", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo synced" })).toBe("synced\n")
      expect((await session.synced()).messages.some((row) => row.endsWith(" idle"))).toBe(true)
      const batch = stack().renProxy.inject(
        { operation: new RegExp(`^POST /host/sync/sessions/${session.sessionId}/uploads/\\d+/messages$`) },
        { type: "hold" },
      )
      await session.opencode.session.update({ sessionID: session.sessionId, title: "Renamed" })
      const expected = await session.local()
      await batch.committed
      await stack().restartCell()
      batch.release()
      expect((await session.synced(expected)).title).toBe("Renamed")
    }, 600_000)

    test("a session whose cell lost its storage continues on its next message from the copy in Postgres", async () => {
      const session = await stack().session({ environment: false })
      await session.turn([ModelProvider.text("first")])
      await session.settled()
      const before = await session.synced()
      await stack().loseCellStorage()
      const second = await session.turn([ModelProvider.text("second")], "next")
      await second.called(1)
      const after = await session.settled()
      expect(before.messages.every((row) => after.some((message) => row.startsWith(`${message.id} `)))).toBe(true)
      expect(SessionDriver.assistantTexts(after).join("")).toBe("firstsecond")
      await session.synced()
    }, 600_000)

    // oxlint-disable-next-line ren/no-comments -- OpenCode's import API takes only a directory, so a restored session has no workspace yet (the TODO in the cell's OpenCode harness).
    test.todo("P5-08 a session with an environment whose cell lost its storage restores, and its next tool call runs in the same container folder", async () => {
      const session = await stack().session()
      expect(await session.tool("shell", { command: "echo kept > kept.txt" })).toBe("(no output)")
      await session.synced()
      await stack().loseCellStorage()
      expect(await session.tool("shell", { command: "cat kept.txt; pwd" })).toBe(
        `kept\n/workspace/${session.sessionId}\n`,
      )
    })
  },
)
