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
  fallback: ReadonlyArray<Session.InlineFile> = [],
) {
  const inline = files.filter(Session.isInline).map((file) => ({ uri: file.url, name: file.name }))
  const drive = files.filter(Session.isDriveFile)
  if (drive.length === 0) return { files: inline, metadata: {}, notes: [] }
  const copies = (error: Harness.Rejected) =>
    fallback.length === 0
      ? Effect.fail(error)
      : Effect.succeed({
          files: [...inline, ...fallback.map((file) => ({ uri: file.url, name: file.name }))],
          metadata: {},
          notes: drive
            .filter((file) => !fallback.some((copy) => copy.name === file.name))
            .map((file) => `(${file.name} is in the space’s drive, which this chat cannot read.)`),
        })
  yield* server.activate(sessionId)
  const instance = yield* Option.match(server.chats, {
    onNone: () => Effect.succeed(undefined),
    onSome: (chats) => Effect.map(Ref.get(chats.instances), (all) => all.get(sessionId)),
  })
  if (!instance) return yield* copies(new Harness.Rejected({ message: "This chat cannot use the space’s drive." }))
  return yield* instance.attach(drive).pipe(
    Effect.map((attached) => ({
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
      notes: [],
    })),
    Effect.catchTag("Harness.Rejected", copies),
  )
})
