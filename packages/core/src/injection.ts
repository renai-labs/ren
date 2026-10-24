export * as Injection from "./injection.js"

import type { Injection } from "@ren/schema/injection"
import { Option, Redacted, Result } from "effect"
import type { CredentialSource } from "./credential-source.js"
import type { Credentials } from "./credentials.js"

export { DenyReason, Op, OpName, Reply, opNames } from "@ren/schema/injection"

type Op = Injection.Op

const breaksHeader = (value: string) => /[\r\n]/u.test(value)

const secretOf = (value: CredentialSource.Value, field: Option.Option<string>) => {
  if (value.type === "key") return Option.some(Redacted.value(value.value))
  if (value.type === "fields")
    return Option.flatMap(field, (name) => Option.map(Option.fromNullishOr(value.fields[name]), Redacted.value))
  if (value.type === "basic") return Option.some(`${value.username}:${Redacted.value(value.password)}`)
  return Option.none()
}

// oxlint-disable-next-line ren/no-comments -- Pure: where one credential's value goes in a request, as the three ops an egress knows (C36). The egress encodes each replaced value for its location; Ren refuses a value that would break a header (README §6.3 rule 6).
export const plan = (
  candidate: Credentials.Candidate,
  value: CredentialSource.Value,
  placeholder: Credentials.Matched["placeholder"],
): Result.Result<ReadonlyArray<Op>, "invalid_value"> => {
  const inject = candidate.inject
  if (inject.op === "route") {
    if (value.type !== "route") return Result.fail("invalid_value")
    if (value.headers.some((header) => breaksHeader(Redacted.value(header.value)))) return Result.fail("invalid_value")
    return Result.succeed([
      {
        op: "route",
        upstream: value.upstream,
        ...Option.match(placeholder, { onNone: () => ({}), onSome: (found) => ({ placeholder: found.text }) }),
      },
      ...value.headers.map((header): Op => ({ op: "setHeader", name: header.name, value: header.value })),
    ])
  }
  const secret = secretOf(
    value,
    Option.flatMap(placeholder, (found) => found.field),
  )
  if (Option.isNone(secret)) return Result.fail("invalid_value")
  if (inject.op === "replace") {
    if (Option.isNone(placeholder)) return Result.succeed([])
    if (inject.in.includes("header") && breaksHeader(secret.value)) return Result.fail("invalid_value")
    return Result.succeed([
      { op: "replace", placeholder: placeholder.value.text, value: Redacted.make(secret.value), in: inject.in },
    ])
  }
  if (breaksHeader(secret.value)) return Result.fail("invalid_value")
  const header =
    inject.format === "Basic {basic}"
      ? `Basic ${Buffer.from(secret.value).toString("base64")}`
      : inject.format.replace("{value}", secret.value)
  return Result.succeed([
    { op: "setHeader", name: inject.name, value: Redacted.make(header) },
    ...Option.match(placeholder, {
      onNone: () => [],
      onSome: (found): ReadonlyArray<Op> => [
        { op: "replace", placeholder: found.text, value: Redacted.make(secret.value), in: ["header"] },
      ],
    }),
  ])
}
