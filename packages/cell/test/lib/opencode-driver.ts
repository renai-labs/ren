export * as OpenCodeDriver from "./opencode-driver.js"

import { Database } from "bun:sqlite"
import { AbsolutePath, OpenCode, type OpenCodeClient, SessionMessage } from "@opencode/client/effect"
import { SessionID } from "@opencode/schema/session-id"
import { OpenCodeRows } from "@ren/opencode-transcript/opencode-rows"
import { Session } from "@ren/schema/session"
import { Sync } from "@ren/schema/sync"
import { Effect, Schema } from "effect"
import { FetchHttpClient } from "effect/http"

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

export const make = (client: OpenCodeClient, directory: string) => {
  const location = { directory: AbsolutePath.make(directory) }
  const wait = (id: Session.ID) =>
    client.experimental.session.wait({ sessionID: SessionID.make(id) }).pipe(Effect.orDie)
  return {
    create: (input: { readonly id?: Session.ID; readonly parentId?: Session.ID } = {}) =>
      client.session
        .create({
          location,
          ...(input.id && { id: SessionID.make(input.id) }),
          ...(input.parentId && { parentID: SessionID.make(input.parentId) }),
        })
        .pipe(
          Effect.orDie,
          Effect.map((session) => Session.ID.make(session.id)),
        ),
    prompt: (id: Session.ID, text: string) =>
      client.session.prompt({ sessionID: SessionID.make(id), text }).pipe(Effect.orDie, Effect.asVoid),
    wait,
    shell: (id: Session.ID, command: string) =>
      client.session.shell({ sessionID: SessionID.make(id), command }).pipe(Effect.orDie),
    interrupt: (id: Session.ID) =>
      client.session.interrupt({ sessionID: SessionID.make(id) }).pipe(Effect.orDie, Effect.asVoid),
    rename: (id: Session.ID, title: string) =>
      client.session.update({ sessionID: SessionID.make(id), title }).pipe(Effect.orDie),
    permissions: (id: Session.ID, rules: ReadonlyArray<Rule>) =>
      client.session.update({ sessionID: SessionID.make(id), permissions: rules }).pipe(Effect.orDie),
    remove: (id: Session.ID) => client.session.remove({ sessionID: SessionID.make(id) }).pipe(Effect.orDie),
    revert: Effect.fnUntraced(function* (id: Session.ID, messageId: string) {
      const sessionID = SessionID.make(id)
      yield* client.session.revert.stage({ sessionID, messageID: SessionMessage.ID.make(messageId) }).pipe(Effect.orDie)
      yield* client.session.revert.commit({ sessionID }).pipe(Effect.orDie)
    }),
    copy: Effect.fnUntraced(function* (from: { readonly database: string; readonly id: Session.ID }) {
      const database = new Database(from.database, { readonly: true })
      const info = OpenCodeRows.session(database.query("select * from session_v2 where id = ?").get(from.id))
      const messages = yield* Effect.forEach(
        Schema.decodeUnknownSync(Schema.Array(Sync.OpenCodeMessageRow))(
          database
            .query("select id, session_id, type, seq, data from session_message where session_id = ? order by seq, id")
            .all(from.id),
        ),
        OpenCodeRows.message,
      )
      database.close()
      yield* client.experimental.session.import({ info, messages, location: info.location }).pipe(Effect.orDie)
    }),
  }
}

export type Driver = ReturnType<typeof make>

export const remote = (url: string, headers: Readonly<Record<string, string>>, directory: string) =>
  OpenCode.make({ baseUrl: url }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(
      FetchHttpClient.Fetch,
      Object.assign(
        (input: string | URL | Request, init?: RequestInit) => {
          const request = new Request(input instanceof Request ? input.url : String(input), init)
          return fetch(new Request(request, { headers: { ...Object.fromEntries(request.headers), ...headers } }))
        },
        { preconnect: fetch.preconnect },
      ),
    ),
    Effect.map((client) => make(client, directory)),
  )
