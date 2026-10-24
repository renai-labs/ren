import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { AppRegistry } from "@ren/core/app/registry"
import { SpaceApp } from "@ren/core/space/app"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Schema } from "effect"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { RealStack } from "../lib/real-stack.js"

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

describe.skipIf(Platform.wrangler !== undefined || Platform.docker !== undefined || Platform.github !== undefined)(
  "an installed app's skills through the real Ren server, a Wrangler cell and a Docker sandbox",
  () => {
    const lane: { stack?: RealStack.Instance } = {}
    const stack = () => {
      if (!lane.stack) throw new Error("the stack did not start")
      return lane.stack
    }

    beforeAll(async () => {
      lane.stack = await RealStack.start({ environments: [{ label: "full" }] })
    }, 600_000)

    afterAll(async () => {
      await lane.stack?.dispose()
    }, 120_000)

    test("a text skill, a skill with files and a GitHub skill load by tool and mention, and files reach the sandbox only on use", async () => {
      const owner = stack().owner
      const marker = crypto.randomUUID()
      const published = await stack().run(
        AppRegistry.Service.use((registry) => registry.publish(batch(marker))).pipe(Effect.provide(AppRegistry.layer)),
      )
      const appId = published.apps.at(0)?.appId
      if (!appId) throw new Error("the app was not published")
      await stack().run(
        SpaceApp.Service.use((service) =>
          service.create(
            { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] },
            { spaceId: owner.spaceId, appId },
          ),
        ).pipe(Effect.provide(SpaceApp.layer)),
      )
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
    }, 600_000)
  },
)
