export * as WebSearch from "./websearch.js"

import type { Form } from "@ren/schema/form"
import type { SessionEvent } from "@ren/schema/session/event"
import { Effect, Option, PubSub } from "effect"

export const kind = "websearch.provider"

export const providerField = (form: Form.Info) =>
  form.fields.find(
    (field): field is Form.StringField => field.type === "string" && field.key === "provider" && Boolean(field.options),
  )

export const selected = (form: Form.Info, options: ReadonlyArray<Form.Option>, chosen: string) => {
  if (!providerField(form)) return chosen
  return options.some((option) => option.value === chosen) ? chosen : options.at(0)?.value
}

export const reply = <E>(input: {
  readonly form: Form.Info
  readonly selection: string | false
  readonly reply: (form: Form.Info, answer: Form.Answer) => Effect.Effect<void, E>
  readonly events: PubSub.PubSub<SessionEvent.Event>
  readonly lost?: Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const selection = input.selection
    if (providerField(input.form)) {
      if (selection === false) return
      return yield* input.reply(input.form, { provider: selection })
    }
    if (selection === false || selection === "random")
      return yield* input.reply(input.form, { choice: selection === false ? "disable" : "allow" })
    const subscription = yield* PubSub.subscribe(input.events)
    const next = (): Effect.Effect<Option.Option<Form.Info>> =>
      Effect.flatMap(PubSub.take(subscription), (event) => {
        if (
          event.type === "form.created" &&
          event.data.form.sessionID === input.form.sessionID &&
          event.data.form.id !== input.form.id &&
          event.data.form.kind === kind &&
          providerField(event.data.form)
        )
          return Effect.succeed(Option.some(event.data.form))
        if (event.type === "form.cancelled" && event.data.id === input.form.id) return Effect.succeedNone
        if (event.type === "form.replied" && event.data.id === input.form.id && event.data.answer.choice !== "choose")
          return Effect.succeedNone
        return next()
      })
    const found = yield* Effect.zipWith(input.reply(input.form, { choice: "choose" }), next(), (_, form) => form, {
      concurrent: true,
    })
    if (Option.isNone(found)) return
    if (!providerField(found.value)?.options?.some((option) => option.value === selection)) return
    return yield* input.reply(found.value, { provider: selection })
  }).pipe(Effect.scoped, Effect.raceFirst(input.lost ?? Effect.never))
