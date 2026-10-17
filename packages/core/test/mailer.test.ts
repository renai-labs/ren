import { describe, expect } from "bun:test"
import { Cause, ConfigProvider, Effect, Exit, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Mailer } from "../src/mailer.js"
import { testEffect } from "./lib/effect.js"
import { Postmark } from "./lib/postmark.js"

const config = (values: Record<string, string>) =>
  ConfigProvider.layerAdd(
    ConfigProvider.fromUnknown({
      POSTMARK_SERVER_TOKEN: "postmark-token",
      EMAIL_FROM: "Ren <hello@ren.ai>",
      EMAIL_INVITE_FROM: "Ren <invites@ren.ai>",
      ...values,
    }),
    { asPrimary: true },
  )

const postmark = (status?: number) =>
  Mailer.layer.pipe(Layer.provideMerge(Postmark.layer(status)), Layer.provide(config({})))

const email = { to: "ada@example.com", subject: "Hello", text: "Hi Ada" }

describe("Mailer", () => {
  testEffect(postmark()).effect("sends through Postmark from the configured addresses", () =>
    Effect.gen(function* () {
      const mailer = yield* Mailer.Service
      const outbox = yield* Postmark.Outbox
      yield* mailer.send(email)
      expect(yield* outbox.next).toEqual({
        token: "postmark-token",
        message: {
          From: "Ren <hello@ren.ai>",
          To: "ada@example.com",
          Subject: "Hello",
          TextBody: "Hi Ada",
          MessageStream: "outbound",
        },
      })

      yield* mailer.send({ ...email, sender: "invitations" })
      expect((yield* outbox.next).message.From).toBe("Ren <invites@ren.ai>")
    }),
  )

  testEffect(postmark(422)).effect("fails when Postmark rejects the email", () =>
    Effect.gen(function* () {
      const mailer = yield* Mailer.Service
      expect((yield* mailer.send(email).pipe(Effect.flip))._tag).toBe("MailerError")
    }),
  )

  testEffect(
    ConfigProvider.layer(ConfigProvider.fromUnknown({ NODE_ENV: "production", POSTMARK_SERVER_TOKEN: "" })),
  ).effect("rejects an empty token in production", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.gen(function* () {
        const mailer = yield* Mailer.Service
        yield* mailer.send(email)
      }).pipe(Effect.provide(Mailer.layer.pipe(Layer.provide(FetchHttpClient.layer))), Effect.exit)
      expect(Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : "").toContain(
        "POSTMARK_SERVER_TOKEN is required outside development/test",
      )
    }),
  )
})
