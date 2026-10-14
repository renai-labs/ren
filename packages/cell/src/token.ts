export * as Token from "./token.js"

import { Option, Result } from "effect"
import { Base64 } from "effect/encoding"

export const read = (authorization: string | null) =>
  Option.fromNullishOr(/^Basic\s+(\S+)$/i.exec(authorization ?? "")?.at(1)).pipe(
    Option.flatMap((basic) => Result.getSuccess(Base64.decodeString(basic))),
    Option.flatMapNullishOr((credential) => /^[^:]*:(.+)$/s.exec(credential)?.at(1)),
  )
