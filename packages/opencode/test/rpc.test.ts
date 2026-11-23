import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { OpenCodeHost } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { Effect, Queue, type Scope, Stream } from "effect"
import { Binding } from "../src/binding.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))

process.env["REN_TOKEN"] = "user-token"

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const open = Effect.fnUntraced(function* (
  ren: Effect.Success<ReturnType<typeof RenServer.make>>,
  options: { readonly space?: string; readonly database?: string } = {},
) {
  const host = yield* OpenCodeHost.make(
    { plugins: [{ package: plugin, options: { url: ren.url, ...(options.space && { space: options.space }) } }] },
    { ...(options.database && { database: options.database }) },
  )
  return { host, rpc: host.client.rpc(RenRpc.Definition), at: { location: host.location } }
})

const info = (space: { readonly id: Space.ID; readonly slug: string; readonly name: string }): RenRpc.SpaceInfo => ({
  id: space.id,
  slug: space.slug,
  name: space.name,
  kind: "shared",
  description: null,
})

test("the plugin lists the joined spaces with the selected one, which is the first joined space until the user selects one", () =>
  run(
    Effect.gen(function* () {
      const ren = yield* RenServer.make()
      const opened = yield* open(ren)
      const listed = yield* opened.rpc.listSpaces({}, opened.at)
      expect(listed).toEqual({ spaces: ren.state.spaces.map(info), selected: ren.state.spaceId })
      expect(yield* opened.rpc.getSpace({}, opened.at)).toEqual(info(ren.state.alpha))
    }),
  ))

test("selecting a space stores it beyond the OpenCode process, wakes its brain, lists its models and tells subscribers", () =>
  run(
    Effect.gen(function* () {
      const ren = yield* RenServer.make()
      const beta = ren.state.beta
      ren.state.models.set(beta.id, RenServer.otherChoices)
      const database = join(mkdtempSync(join(tmpdir(), "ren-storage-")), "opencode.db")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* open(ren, { space: "alpha", database })
          const events = yield* Queue.unbounded<{ readonly type: string; readonly data: unknown }>()
          yield* opened.host.client.event.subscribe({ types: ["rpc.ren.spaceSelected"] }).pipe(
            Stream.runForEach((event) => Queue.offer(events, event)),
            Effect.forkScoped,
          )
          expect((yield* Queue.take(events)).type).toBe("server.connected")
          const selected = yield* opened.rpc.selectSpace({ spaceId: beta.id }, opened.at)
          expect(selected).toEqual(info(beta))
          expect(yield* Queue.take(ren.prepared)).toBe(beta.id)
          expect(yield* Queue.take(events)).toMatchObject({ type: "rpc.ren.spaceSelected", data: info(beta) })
          const models = yield* opened.host.client.model.list({ location: opened.host.location }).pipe(Effect.orDie)
          expect(models.data.filter((each) => each.providerID === "ren").map((each) => String(each.id))).toEqual([
            "stub/first-model",
            "stub/other-model",
          ])
        }),
      )
      const reopened = yield* open(ren, { space: "alpha", database })
      expect(yield* reopened.rpc.getSpace({}, reopened.at)).toEqual(info(beta))
    }),
  ))

test("a new session is a local session bound to the selected space with a Ren model, and its first prompt creates the Ren session there", () =>
  run(
    Effect.gen(function* () {
      const ren = yield* RenServer.make()
      const beta = ren.state.beta
      ren.state.models.set(beta.id, RenServer.otherChoices)
      ren.state.answer = (prompt) => {
        ren.state.delivered.add(prompt.id)
        ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
        ren.send(RenServer.frame("session.execution.succeeded", { sessionID: prompt.sessionID }))
      }
      const opened = yield* open(ren)
      yield* opened.rpc.selectSpace({ spaceId: beta.id }, opened.at)
      const chosen = yield* opened.rpc.createSession({ model: { id: "stub/first-model" } }, opened.at)
      const fallback = yield* opened.rpc.createSession({ model: { id: "stub/stub-model" } }, opened.at)
      const local = (sessionID: string) =>
        opened.host.client.session.get({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie)
      expect(chosen.spaceId).toBe(beta.id)
      expect(yield* local(chosen.sessionID)).toMatchObject({
        metadata: { ren: { spaceId: beta.id } },
        model: { providerID: "ren", id: "stub/first-model" },
      })
      expect(yield* local(fallback.sessionID)).toMatchObject({ model: { providerID: "ren", id: "stub/other-model" } })
      expect(ren.state.created).toEqual([])

      const sessionID = Binding.LocalID.make(chosen.sessionID)
      yield* opened.host.client.session.prompt({ sessionID, text: "hello" }).pipe(Effect.orDie)
      yield* opened.host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
      expect(ren.state.created).toEqual([
        { id: Session.ID.make(chosen.sessionID), spaceId: beta.id, model: { providerID: "stub", id: "first-model" } },
      ])
      expect((yield* local(chosen.sessionID)).metadata).toEqual({
        ren: { spaceId: beta.id, sessionId: chosen.sessionID },
      })
    }),
  ))
