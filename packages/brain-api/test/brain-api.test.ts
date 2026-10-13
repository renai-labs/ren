import { describe, expect, test } from "bun:test"
import { HttpApi, HttpApiGroup, OpenApi } from "effect/http-api"
import { BrainApi } from "../src/brain-api.js"
import { BrainRejectedError, SessionNotStartedError } from "../src/errors.js"

const groups = () => {
  const found: Array<HttpApiGroup.Top> = []
  HttpApi.reflect(BrainApi, { onGroup: (options) => found.push(options.group), onEndpoint: () => {} })
  return found
}

describe("Brain API", () => {
  test("serves brain.start at POST /ren/sessions and brain.send at POST /ren/sessions/:id/messages", () => {
    expect(
      groups().flatMap((group) =>
        Object.values(group.endpoints).map((endpoint) => `${endpoint.method} ${endpoint.path} ${endpoint.identifier}`),
      ),
    ).toEqual(["POST /ren/sessions brain.start", "POST /ren/sessions/:id/messages brain.send"])
  })

  test("each endpoint declares its success and its errors", () => {
    const paths = OpenApi.fromApi(BrainApi).paths
    expect(Object.keys(paths["/ren/sessions"]?.post?.responses ?? {}).toSorted()).toEqual(["200", "403", "422"])
    expect(Object.keys(paths["/ren/sessions/{id}/messages"]?.post?.responses ?? {}).toSorted()).toEqual([
      "200",
      "403",
      "409",
      "422",
    ])
  })

  test("BrainRejectedError answers 422 and SessionNotStartedError 409, each a tagged error", () => {
    const responses = OpenApi.fromApi(BrainApi).paths["/ren/sessions/{id}/messages"]?.post?.responses ?? {}
    expect([responses["422"]?.description, responses["409"]?.description]).toEqual([
      "BrainRejectedError",
      "SessionNotStartedError",
    ])
    expect([
      new BrainRejectedError({ message: "unknown agent" })._tag,
      new SessionNotStartedError({ message: "no session" })._tag,
    ]).toEqual(["BrainRejectedError", "SessionNotStartedError"])
  })
})
