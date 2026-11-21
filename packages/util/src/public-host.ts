export * as PublicHost from "./public-host.js"

const name = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/u

const privateSuffix = /\.(?:alt|example|home\.arpa|internal|invalid|local|localhost|onion|test|ts\.net)$/u

export function isPublic(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/u, "")
  return host.length <= 253 && name.test(host) && !privateSuffix.test(host)
}
