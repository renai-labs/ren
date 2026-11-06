export * as WebhookParser from "./webhook-parser.js"

import {
  CelScalar,
  type CelUint,
  type CelValue,
  celFunc,
  isCelError,
  isCelList,
  isCelMap,
  isCelUint,
  parse,
  run,
} from "@bufbuild/cel"
import type { Webhook } from "@ren/schema/webhook"
import { Option, Predicate, Result, Schema } from "effect"

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

export interface Request {
  readonly method: string
  readonly query: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

export interface Values {
  readonly method: string
  readonly query: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string>>
  readonly body: Schema.Json
}

const fromJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))

// oxlint-disable-next-line ren/no-comments -- W32: `body` is a map for JSON and form bodies, and the text for every other type.
const bodyOf = (contentType: string | undefined, body: string): Schema.Json => {
  const type = (contentType ?? "").split(";").at(0)?.trim().toLowerCase() ?? ""
  if (type === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(body))
  if (type === "application/json" || type.endsWith("+json")) return Option.getOrElse(fromJson(body), () => body)
  return body
}

export const valuesOf = (request: Request): Values => ({
  method: request.method,
  query: request.query,
  headers: request.headers,
  body: bodyOf(request.headers["content-type"], request.body),
})

const keyOf = (key: bigint | string | boolean | CelUint) => (isCelUint(key) ? key.value.toString() : key.toString())

// oxlint-disable-next-line ren/no-comments -- A CEL value as JSON: ints become numbers, lists and maps stay; bytes, types and messages are null.
const toJson = (value: CelValue): Schema.Json => {
  if (typeof value === "bigint") return Number(value)
  if (isCelUint(value)) return Number(value.value)
  if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value) || Predicate.isNull(value))
    return value
  if (isCelList(value)) return Array.from(value, toJson)
  if (isCelMap(value))
    return Object.fromEntries(Array.from(value.keys(), (key) => [keyOf(key), toJson(value.get(key) ?? null)]))
  return null
}

const evaluate = (
  field: Field,
  expression: string,
  values: Values,
  sign?: (text: string) => string,
): Result.Result<CelValue, string> => {
  const result = run(
    expression,
    { ...values },
    sign ? { funcs: [celFunc("sign", [CelScalar.STRING], CelScalar.STRING, sign)] } : {},
  )
  return isCelError(result) ? Result.fail(`${field}: ${result.message}`) : Result.succeed(result)
}

const text = (field: Field, value: CelValue): Result.Result<string, string> => {
  if (Predicate.isString(value)) return value.length > 0 ? Result.succeed(value) : Result.fail(`${field}: empty`)
  if (typeof value === "bigint" || Predicate.isNumber(value)) return Result.succeed(value.toString())
  if (isCelUint(value)) return Result.succeed(value.value.toString())
  return Result.fail(`${field}: not a string`)
}

export interface Answer {
  readonly status: number
  readonly contentType?: string
  readonly body?: Schema.Json
}

const Answered = Schema.Struct({
  status: Schema.Int.check(Schema.isBetween({ minimum: 200, maximum: 299 })),
  contentType: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.Json),
})

const decodeAnswer = Schema.decodeUnknownOption(Answered)

// oxlint-disable-next-line ren/no-comments -- Spec section 3.1: a map answers the request; null goes on. `sign` exists only after the signature check (W38).
export const handshake = (
  field: "handshake" | "signedHandshake",
  expression: string | undefined,
  values: Values,
  sign?: (text: string) => string,
): Result.Result<Option.Option<Answer>, string> => {
  if (!expression) return Result.succeed(Option.none())
  return Result.flatMap(evaluate(field, expression, values, sign), (value) => {
    if (Predicate.isNull(value)) return Result.succeed(Option.none())
    return Option.match(decodeAnswer(toJson(value)), {
      onNone: () => Result.fail(`${field}: not a map with a 2xx status`),
      onSome: (answer) => Result.succeed(Option.some(answer)),
    })
  })
}

export type Parsed =
  | { readonly _tag: "Ignored"; readonly broken: boolean; readonly reason: string }
  | {
      readonly _tag: "Passed"
      readonly eventId: Option.Option<string>
      readonly threadKey: Option.Option<string>
      readonly title: Option.Option<string>
    }

const optional = (field: Field, expression: string | undefined, values: Values) =>
  expression
    ? Result.map(
        Result.flatMap(evaluate(field, expression, values), (value) => text(field, value)),
        Option.some,
      )
    : Result.succeed(Option.none<string>())

// oxlint-disable-next-line ren/no-comments -- Spec section 3: filter, then eventId, then threadKey. An error in any is broken; a false filter is normal filtering. A broken title falls back to the default title.
export const parsed = (parser: Webhook.Parser, values: Values): Parsed => {
  const filter = parser.filter ? evaluate("filter", parser.filter, values) : Result.succeed<CelValue>(true)
  if (Result.isFailure(filter)) return { _tag: "Ignored", broken: true, reason: filter.failure }
  if (filter.success !== true) return { _tag: "Ignored", broken: false, reason: "filter is false" }
  const eventId = optional("eventId", parser.eventId, values)
  if (Result.isFailure(eventId)) return { _tag: "Ignored", broken: true, reason: eventId.failure }
  const threadKey = optional("threadKey", parser.threadKey, values)
  if (Result.isFailure(threadKey)) return { _tag: "Ignored", broken: true, reason: threadKey.failure }
  return {
    _tag: "Passed",
    eventId: eventId.success,
    threadKey: threadKey.success,
    title: Result.getOrElse(optional("title", parser.title, values), () => Option.none()),
  }
}
