import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Mailer } from "../src/mailer.js"
import { testEffect } from "./lib/effect.js"
import { Postmark } from "./lib/postmark.js"

const postmark = (status?: number, config: Record<string, string> = { EMAIL_INVITE_FROM: "Ren <invites@ren.ai>" }) =>
  Mailer.layer.pipe(
    Layer.provideMerge(Postmark.layer(status)),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown({
          POSTMARK_SERVER_TOKEN: "postmark-token",
          EMAIL_FROM: "Ren <hello@ren.ai>",
          ...config,
        }),
        { asPrimary: true },
      ),
    ),
  )

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

  testEffect(postmark(200, {})).effect("sends invitations from the default address without an invite address", () =>
    Effect.gen(function* () {
      const mailer = yield* Mailer.Service
      const outbox = yield* Postmark.Outbox
      yield* mailer.send({ ...email, sender: "invitations" })
      expect((yield* outbox.next).message.From).toBe("Ren <hello@ren.ai>")
    }),
  )

  testEffect(postmark(422)).effect("fails when Postmark rejects the email", () =>
    Effect.gen(function* () {
      const mailer = yield* Mailer.Service
      const error = yield* mailer.send(email).pipe(Effect.flip)
      expect(error._tag).toBe("MailerError")
    }),
  )

  testEffect(Mailer.layer.pipe(Layer.provide(FetchHttpClient.layer))).effect(
    "logs instead of sending without a token",
    () =>
      Effect.gen(function* () {
        const mailer = yield* Mailer.Service
        yield* mailer.send(email)
      }),
  )
})
