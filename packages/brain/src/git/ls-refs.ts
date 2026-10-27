export * as LsRefs from "./ls-refs.js"

import { Effect } from "effect"
import { HttpClientRequest, type HttpClientResponse } from "effect/http"

export const commitPattern = /^[0-9a-f]{40}$/u

// oxlint-disable-next-line ren/no-comments -- R9: anonymous is a read without Authorization; placeholder is a read with ren:<LABEL>, which the egress replaces with the token of the space.
export type Access = "anonymous" | "placeholder"

const encoder = new TextEncoder()

const pktLine = (line: string) => `${(encoder.encode(line).length + 4).toString(16).padStart(4, "0")}${line}`

// oxlint-disable-next-line ren/no-comments -- R34: git protocol v2 ls-refs with ref-prefix, so the host sends only these refs and not every pull request ref. "0001" ends the command, "0000" ends the request.
const body = (ref: string | undefined) =>
  [
    pktLine("command=ls-refs\n"),
    pktLine("object-format=sha1\n"),
    "0001",
    pktLine("peel\n"),
    pktLine("symrefs\n"),
    ...(ref && !commitPattern.test(ref)
      ? [pktLine(`ref-prefix refs/heads/${ref}\n`), pktLine(`ref-prefix refs/tags/${ref}\n`)]
      : [pktLine("ref-prefix HEAD\n")]),
    "0000",
  ].join("")

// oxlint-disable-next-line ren/no-comments -- Each ls-refs line is "<oid> <name>[ symref-target:<ref>][ peeled:<oid>]". A peeled oid is the commit of an annotated tag.
const listed = (bytes: Uint8Array) => {
  const refs = new Map<string, string>()
  const decoder = new TextDecoder()
  let offset = 0
  while (offset + 4 <= bytes.length) {
    const length = Number.parseInt(decoder.decode(bytes.subarray(offset, offset + 4)), 16)
    if (Number.isNaN(length)) break
    const fields = decoder
      .decode(bytes.subarray(offset + 4, offset + Math.max(length, 4)))
      .trim()
      .split(" ")
    const oid = fields.at(0) ?? ""
    const name = fields.at(1)
    const peeled = fields.find((field) => field.startsWith("peeled:"))?.slice("peeled:".length)
    if (name && commitPattern.test(oid)) refs.set(name, peeled ?? oid)
    offset += Math.max(length, 4)
  }
  return refs
}

// oxlint-disable-next-line ren/no-comments -- ref-prefix matches by prefix, so the names are compared exactly. A 40-character commit is its own answer (R33).
export const commitOf = (bytes: Uint8Array, ref: string | undefined) => {
  const refs = listed(bytes)
  if (!ref) return refs.get("HEAD")
  if (commitPattern.test(ref)) return ref
  return refs.get(`refs/heads/${ref}`) ?? refs.get(`refs/tags/${ref}`)
}

// oxlint-disable-next-line ren/no-comments -- R9: the request goes without Authorization first; after a 401 or a 404 it goes again with the placeholder in `authorization`.
export const request = <E>(
  send: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<HttpClientResponse.HttpClientResponse, E>,
  input: { readonly url: string; readonly ref: string | undefined; readonly authorization: string },
) =>
  Effect.gen(function* () {
    const anonymous = HttpClientRequest.post(input.url).pipe(
      HttpClientRequest.setHeaders({ "git-protocol": "version=2", accept: "application/x-git-upload-pack-result" }),
      HttpClientRequest.bodyText(body(input.ref), "application/x-git-upload-pack-request"),
    )
    const first = yield* send(anonymous)
    if (first.status !== 401 && first.status !== 404) return { response: first, access: "anonymous" } as const
    const response = yield* send(HttpClientRequest.setHeader(anonymous, "authorization", input.authorization))
    return { response, access: "placeholder" } as const
  })
