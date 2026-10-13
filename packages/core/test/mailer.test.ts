import { describe, expect } from "bun:test"
import { Cause, ConfigProvider, Effect, Exit, Layer, Logger } from "effect"
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

  for (const scenario of [
    { name: "missing token in production", values: { NODE_ENV: "production" } },
    { name: "empty token in production", values: { NODE_ENV: "production", POSTMARK_SERVER_TOKEN: "" } },
  ]) {
    testEffect(ConfigProvider.layer(ConfigProvider.fromUnknown(scenario.values))).effect(
      `rejects ${scenario.name} without logging email secrets`,
      () =>
        Effect.gen(function* () {
          const logs: unknown[] = []
          const exit = yield* Effect.gen(function* () {
            const mailer = yield* Mailer.Service
            yield* mailer.send({ ...email, text: "private-reset-token" })
          }).pipe(
            Effect.provide(Mailer.layer.pipe(Layer.provide(FetchHttpClient.layer))),
            Effect.provide(Logger.layer([Logger.make((options) => logs.push(options.message))])),
            Effect.exit,
          )
          expect(Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : "").toContain(
            "POSTMARK_SERVER_TOKEN is required outside development/test",
          )
          expect(logs).toEqual([])
        }),
    )
  }
})
