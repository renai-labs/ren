export * as TaskFixture from "./task-fixture.js"

import { Shared } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Agent } from "@ren/schema/agent"
import type { Session } from "@ren/schema/session"
import type { Space as SpaceSchema } from "@ren/schema/space"
import type { TaskActivity as Activity } from "@ren/schema/task-activity"
import { and, eq, isNull } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Access } from "../../src/access.js"
import { EgressControl } from "../../src/egress-control.js"
import type { Actor } from "../../src/actor.js"
import { BrainRegistry } from "../../src/brain-registry.js"
import { Label } from "../../src/label.js"
import { Models } from "../../src/models.js"
import { SessionRunner } from "../../src/session/runner.js"
import { Space } from "../../src/space.js"
import { SpaceMember } from "../../src/space/member.js"
import { Task } from "../../src/task.js"
import { TaskActivity } from "../../src/task/activity.js"
import { TaskComment } from "../../src/task/comment.js"
import { testEffect } from "./effect.js"
import { Host } from "./host.js"
import { Seed } from "./seed.js"

export const harness = () => {
  const stub = Shared.stub()
  const configured = Shared.access({ stub: Shared.apiKey("sk-configured") }, stub.url)
  const models = Layer.succeed(
    Models.Service,
    Models.Service.of({
      revision: Effect.succeed("test"),
      catalog: () => Effect.succeed(Models.catalog(configured)),
      grant: () => Effect.succeed(configured),
    }),
  )
  return {
    stub,
    it: testEffect(
      Layer.mergeAll(Task.layer, TaskComment.layer, TaskActivity.layer, Label.layer).pipe(
        Layer.provideMerge(Layer.mergeAll(Space.layer, SpaceMember.layer, SessionRunner.layer)),
        Layer.provideMerge(BrainRegistry.layer),
        Layer.provideMerge(Host.layer({}, models)),
        Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)),
        Layer.provideMerge(Testing.layer),
      ),
    ),
  }
}

export const page = { page: 1, pageSize: 50 }

export const kinds = (activity: { readonly items: ReadonlyArray<Activity.Info> }) =>
  activity.items.map((item) => (item.type === "event" ? item.event.data._tag : "comment"))

export const actingAs = (actor: Actor.Info, spaceId: SpaceSchema.ID, agentId: Agent.ID, sessionId: Session.ID) => ({
  ...actor,
  agent: { agentId, sessionId, spaceId },
})

export const org = Effect.gen(function* () {
  const database = yield* Database.Service
  const spaces = yield* Space.Service
  yield* Seed.ren()
  const organizationId = yield* Seed.organization()
  const ada = yield* Seed.actor(organizationId, "member")
  const grace = yield* Seed.actor(organizationId, "member")
  const admin = yield* Seed.actor(organizationId, "admin")
  const factory = yield* spaces.create(ada, { name: "Factory" })
  const eng = yield* spaces.create(grace, { name: "Eng" })
  const slug = (yield* database.db
    .select({ slug: Database.Schema.organization.slug })
    .from(Database.Schema.organization)
    .where(eq(Database.Schema.organization.id, organizationId))).at(0)?.slug
  const ren = (yield* database.db
    .select({ id: Database.Schema.agent.id })
    .from(Database.Schema.agent)
    .where(and(eq(Database.Schema.agent.name, "ren"), isNull(Database.Schema.agent.organization_id)))).at(0)?.id
  if (!slug || !ren) return yield* Effect.die(new Error("The seed wrote no organization or ren agent"))
  const agent = (name: string, spaceId: SpaceSchema.ID = factory.id) =>
    Seed.agent({ organizationId, spaceId }, name, { isSubagent: false })
  const agentIn = Effect.fnUntraced(function* (actor: Actor.Info, spaceId: SpaceSchema.ID) {
    const agentId = yield* agent("build", spaceId)
    const sessionId = yield* Seed.session({ organizationId, spaceId, createdBy: actor.userId })
    return actingAs(actor, spaceId, agentId, sessionId)
  })
  return { organizationId, prefix: slug.toUpperCase(), ren, ada, grace, admin, factory, eng, agent, agentIn }
})
