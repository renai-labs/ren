export * as OAuthFetch from "./oauth-fetch.js"

import { lookup } from "node:dns/promises"
import { request } from "node:https"
import { BlockList, isIP } from "node:net"
import { Context, Layer } from "effect"

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface Interface {
  readonly fetch: Fetch
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/OAuthFetch") {}

export const maximumBytes = 1024 * 1024

export const timeoutMillis = 10_000

const blocked = { ipv4: new BlockList(), ipv6: new BlockList() }

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.ipv4.addSubnet(network, prefix, "ipv4")

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.ipv6.addSubnet(network, prefix, "ipv6")

const isBlocked = (address: { readonly address: string; readonly family: number }) =>
  address.family === 4 ? blocked.ipv4.check(address.address, "ipv4") : blocked.ipv6.check(address.address, "ipv6")

// oxlint-disable-next-line ren/no-comments -- K31 and ren-v1 `util/public-https.ts`: HTTPS to a public address only, the connection pinned to the address Ren checked (no DNS rebinding), no redirect followed, 10 s, at most 1 MiB. `@better-auth/cimd/node` does the same for GET only, so it cannot send token requests.
const fetchPublic: Fetch = async (input, init) => {
  const sent = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init)
  const url = new URL(sent.url)
  if (url.protocol !== "https:") throw new Error("Sign-in requests need HTTPS")
  if (url.username || url.password) throw new Error("Sign-in addresses cannot hold a user name or password")
  const hostname = url.hostname.replaceAll(/^\[|\]$/gu, "")
  const literal = isIP(hostname)
  const addresses =
    literal === 0 ? await lookup(hostname, { all: true }) : [{ address: hostname, family: literal }]
  const target = addresses.at(0)
  if (!target) throw new Error(`No address found for ${hostname}`)
  if (addresses.some(isBlocked)) throw new Error(`${hostname} has a private or reserved address`)
  const body = sent.body ? Buffer.from(await sent.arrayBuffer()) : undefined
  const signal = AbortSignal.any([sent.signal, AbortSignal.timeout(timeoutMillis)])
  return new Promise<Response>((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: sent.method,
        headers: Object.fromEntries(sent.headers),
        signal,
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, [{ address: target.address, family: target.family }])
            : callback(null, target.address, target.family),
      },
      (incoming) => {
        const chunks: Array<Buffer> = []
        let size = 0
        incoming.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > maximumBytes) incoming.destroy(new Error("The answer is larger than 1 MiB"))
          else chunks.push(chunk)
        })
        incoming.on("error", reject)
        incoming.on("end", () => {
          const headers = new Headers()
          for (const [name, value] of Object.entries(incoming.headers))
            for (const item of [value ?? []].flat()) headers.append(name, item)
          resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 502, headers }))
        })
      },
    )
    outgoing.on("error", reject)
    outgoing.end(body)
  })
}

export const layerPublic = Layer.succeed(Service, Service.of({ fetch: fetchPublic }))

// oxlint-disable-next-line ren/no-comments -- Local development and tests: OAuth servers on 127.0.0.1 over HTTP. Redirects are still not followed, and the time limit stays.
export const layerUnchecked = Layer.succeed(
  Service,
  Service.of({
    fetch: (input, init) => fetch(input, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMillis) }),
  }),
)
