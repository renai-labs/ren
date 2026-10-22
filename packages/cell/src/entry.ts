export * as Entry from "./entry.js"

import { BrainToken } from "@ren/host-api/brain-token"
import type { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import type { Signature } from "@ren/schema/signature"
import { Effect, Option } from "effect"
import { Chat } from "./chat.js"
import { Token } from "./token.js"

export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
}

export const withCors = (response: Response) => {
  const headers = new Headers(response.headers)
  headers.set("access-control-allow-origin", "*")
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export interface Checked {
  readonly brain: Brain.ID
  readonly request: Request
}

const unauthorized = () =>
  Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 })

const forbidden = (message: string) => Response.json({ _tag: "ForbiddenError", message }, { status: 403 })

export const check = Effect.fn("Entry.check")(function* (
  request: Request,
  options: {
    readonly keys: Effect.Effect<ReadonlyArray<Signature.PublicKey>>
    readonly brain: Option.Option<Brain.ID>
    readonly generation: number
  },
) {
  const isChat = Chat.owns(new URL(request.url).pathname)
  const token = Token.read(request.headers.get("authorization"))
  const claims = Option.isSome(token) ? yield* BrainToken.verify(yield* options.keys, token.value) : Option.none()
  if (Option.isNone(claims) || claims.value.scope === "host") return unauthorized()
  if (Option.isSome(options.brain) && claims.value.brain !== options.brain.value)
    return forbidden("The token is for another brain")
  if (claims.value.gen !== options.generation) return forbidden("The token is for another generation of this brain")
  if (claims.value.scope !== "server" && !isChat) return forbidden("A client token reaches only the Chat API")
  const headers = new Headers(request.headers)
  headers.delete("authorization")
  Chat.setMember(
    headers,
    claims.value.scope === "client"
      ? {
          sub: claims.value.sub,
          sid: claims.value.sid,
          exp: claims.value.exp,
          ...(claims.value.name && { name: claims.value.name }),
        }
      : {},
  )
  const oversized = Number(headers.get("content-length")) > Session.maxBodyBytes
  const chunks: Array<Uint8Array<ArrayBuffer>> = []
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = request.body?.getReader()
  let bytes = 0
  if (reader) {
    let chunk = yield* Effect.promise(() => reader.read())
    // oxlint-disable-next-line ren/no-comments -- Cancelling an oversized request body can break the next keep-alive request in workerd; drain excess bytes without retaining them.
    while (!chunk.done) {
      bytes += chunk.value.byteLength
      if (oversized || bytes > Session.maxBodyBytes) chunks.length = 0
      else chunks.push(new Uint8Array(chunk.value))
      chunk = yield* Effect.promise(() => reader.read())
    }
  }
  if (oversized || bytes > Session.maxBodyBytes) return new Response(null, { status: 413 })
  return {
    brain: claims.value.brain,
    request: new Request(request.url, {
      method: request.method,
      headers,
      body: reader ? new Blob(chunks) : null,
      signal: request.signal,
    }),
  } satisfies Checked
})
