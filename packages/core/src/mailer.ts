export * as Mailer from "./mailer.js"

import { Environment } from "@ren/util/environment"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

export interface Email {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly sender?: "default" | "invitations"
}

export class MailerError extends Schema.TaggedError<MailerError>()("MailerError", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly send: (email: Email) => Effect.Effect<void, MailerError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Mailer") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const token = Option.filter(
      yield* Config.option(Config.Redacted("POSTMARK_SERVER_TOKEN")),
      (value) => Redacted.value(value) !== "",
    )
    if (Option.isNone(token)) {
      if (!(yield* Environment.local)) {
        return yield* Effect.die(new Error("POSTMARK_SERVER_TOKEN is required outside development/test"))
      }
      return Service.of({
        send: Effect.fn("Mailer.send")(function* (email: Email) {
          yield* Effect.logInfo(`Email to ${email.to}: ${email.subject}\n${email.text}`)
        }),
      })
    }
    const from = yield* Config.String("EMAIL_FROM")
    const inviteFrom = yield* Config.String("EMAIL_INVITE_FROM").pipe(Config.withDefault(from))
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    return Service.of({
      send: Effect.fn("Mailer.send")(function* (email: Email) {
        yield* HttpClientRequest.post("https://api.postmarkapp.com/email").pipe(
          HttpClientRequest.setHeader("X-Postmark-Server-Token", Redacted.value(token.value)),
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyJsonUnsafe({
            From: email.sender === "invitations" ? inviteFrom : from,
            To: email.to,
            Subject: email.subject,
            TextBody: email.text,
            MessageStream: "outbound",
          }),
          client.execute,
          Effect.timeout("10 seconds"),
          Effect.mapError((cause) => new MailerError({ cause })),
        )
      }),
    })
  }),
)
