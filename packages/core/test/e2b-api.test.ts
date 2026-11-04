import { describe, expect, test } from "bun:test"
import { Option, Redacted } from "effect"
import { E2BApi } from "../src/e2b-api.js"

const proxy = { address: "egress.test:8080", username: "env", password: Redacted.make("secret"), ca: Option.none() }

describe("E2BApi.networkOf", () => {
  test("a limited list allows each host and the apex of each wildcard, denies every IP range and keeps the proxy", () => {
    expect(
      E2BApi.networkOf({
        hosts: Option.some(["api.example.com", "*.github.com", "github.com"]),
        proxy: Option.some(proxy),
      }),
    ).toEqual({
      allowOut: ["api.example.com", "*.github.com", "github.com"],
      denyOut: ["0.0.0.0/0"],
      egressProxy: { address: "egress.test:8080", username: "env", password: "secret" },
    })
  })

  test("unrestricted networking behind the egress sends every host name to the proxy", () => {
    expect(E2BApi.networkOf({ hosts: Option.none(), proxy: Option.some(proxy) })).toMatchObject({
      allowOut: ["*"],
      denyOut: ["0.0.0.0/0"],
    })
  })
})
