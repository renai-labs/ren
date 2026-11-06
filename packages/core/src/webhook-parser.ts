export * as WebhookParser from "./webhook-parser.js"

import { parse } from "@bufbuild/cel"
import type { Webhook } from "@ren/schema/webhook"
import { Option, Result } from "effect"

export const fields = ["handshake", "signedHandshake", "filter", "eventId", "threadKey", "title"] as const

export type Field = (typeof fields)[number]

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// oxlint-disable-next-line ren/no-comments -- Ren checks that each expression compiles before it saves a parser (spec section 3).
export const check = (parser: Webhook.Parser) =>
  Option.firstSomeOf(
    fields.map((field) => {
      const expression = parser[field]
      if (!expression) return Option.none<{ readonly field: Field; readonly message: string }>()
      return Result.match(
        Result.try(() => parse(expression)),
        {
          onSuccess: () => Option.none(),
          onFailure: (error) => Option.some({ field, message: messageOf(error) }),
        },
      )
    }),
  )
