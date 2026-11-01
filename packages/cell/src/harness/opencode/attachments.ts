export * as OpenCodeAttachments from "./attachments.js"

import { Session } from "@ren/schema/session"
import { Effect, Option, Ref } from "effect"
import { Base64 } from "effect/encoding"
import { Harness } from "../harness.js"
import type { OpenCodeServer } from "./server.js"

export type Prepared = Effect.Success<ReturnType<typeof prompt>>

export const prompt = Effect.fn("OpenCodeAttachments.prompt")(function* (
  server: Pick<OpenCodeServer.Instance, "activate" | "chats">,
  sessionId: string,
  files: ReadonlyArray<Session.File>,
) {
  const inline = files.filter(Session.isInline).map((file) => ({ uri: file.url, name: file.name }))
  const drive = files.filter(Session.isDriveFile)
  if (drive.length === 0) return { files: inline, metadata: {} }
  yield* server.activate(sessionId)
  const instance = yield* Option.match(server.chats, {
    onNone: () => Effect.succeed(undefined),
    onSome: (chats) => Effect.map(Ref.get(chats.instances), (all) => all.get(sessionId)),
  })
  if (!instance) return yield* new Harness.Rejected({ message: "This chat cannot use the space’s drive." })
  const attached = yield* instance.attach(drive)
  return {
    files: [
      ...inline,
      ...attached.flatMap((each) =>
        Option.match(each.bytes, {
          onNone: () => [],
          onSome: (bytes) => [{ uri: `data:${each.file.mime};base64,${Base64.encode(bytes)}`, name: each.file.name }],
        }),
      ),
    ],
    metadata: { files: attached.map((each) => each.file) },
  }
})
