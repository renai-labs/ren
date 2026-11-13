import { describe, expect, test } from "bun:test"
import { PublicHost } from "../src/public-host.js"

describe("PublicHost.isPublic", () => {
  test.each([
    "github.com",
    "Docs.Stripe.com",
    "stripe.com.",
    "a-b.example.co.uk",
    "xn--80ak6aa92e.xn--p1ai",
    "ts.net.com",
  ])("%s is public", (host) => expect(PublicHost.isPublic(host)).toBe(true))

  test.each([
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "10.0.0.1",
    "[::1]",
    "::1",
    "intranet",
    "printer.local",
    "wiki.internal",
    "site.test",
    "site.example",
    "site.invalid",
    "site.alt",
    "abc.onion",
    "router.home.arpa",
    "laptop.tailnet.ts.net",
    "-bad.com",
    "bad..com",
    "",
  ])("%s is not public", (host) => expect(PublicHost.isPublic(host)).toBe(false))
})
